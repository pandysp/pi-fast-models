import { calculateCost, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ExtensionVirtualModel } from "@earendil-works/pi-coding-agent";

const PROVIDER = "openai-codex";
// Each real model gets a `-fast` twin.
const REAL_NAMES: Record<string, string> = {
	"gpt-6.2-sol": "GPT-6.2 Sol",
	"gpt-6.2-astra": "GPT-6.2 Astra",
};
const FAST_TO_REAL = new Map(Object.keys(REAL_NAMES).map(real => [`${real}-fast`, real]));
const FAST_RATE = 2;

function realModel(ctx: ExtensionContext, id: string) {
	const model = ctx.modelRegistry.find(PROVIDER, id);
	if (!model) throw new Error(`pi-fast-models: ${PROVIDER}/${id} is missing. Update pi's model catalog.`);
	return model;
}

export default function (pi: ExtensionAPI) {
	let requestedFast: string | undefined;

	const definitions = [...FAST_TO_REAL].map(([fast, real]): ExtensionVirtualModel => ({
		provider: PROVIDER,
		id: fast,
		name: `${REAL_NAMES[real]} Fast`,
		// Startup resolves --thinking before session_start; without this pi would clamp "high" to "low".
		thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
		route(request, ctx) {
			return { model: realModel(ctx, real), thinkingLevel: request.thinkingLevel };
		},
	}));

	// Copy live limits and levels onto a fast model; re-registering also refreshes the selected model.
	function syncMetadata(ctx: ExtensionContext, definition: ExtensionVirtualModel) {
		const model = realModel(ctx, FAST_TO_REAL.get(definition.id)!);
		pi.registerVirtualModel({
			...definition,
			thinkingLevels: getSupportedThinkingLevels(model),
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
			input: model.input,
		});
	}

	// Register before startup model selection; live metadata is available at session_start.
	for (const definition of definitions) pi.registerVirtualModel(definition);

	pi.on("session_start", (_event, ctx) => {
		for (const definition of definitions) {
			// A partial catalog must not break startup for unrelated models. Routing still requires the real entry.
			if (ctx.modelRegistry.find(PROVIDER, FAST_TO_REAL.get(definition.id)!)) syncMetadata(ctx, definition);
		}
	});
	pi.on("model_select", ({ model }, ctx) => {
		// Pi keeps the startup copy in its Ctrl+P list, so cycling back would restore 0 limits.
		const definition = definitions.find(d => model.provider === PROVIDER && d.id === model.id);
		if (definition) syncMetadata(ctx, definition);
	});

	pi.on("turn_start", () => { requestedFast = undefined; });
	pi.on("before_provider_request", ({ payload }, ctx) => {
		requestedFast = undefined;
		const real = ctx.model?.provider === PROVIDER ? FAST_TO_REAL.get(ctx.model.id) : undefined;
		if (!real || (payload as { model?: string }).model !== real) return;
		requestedFast = real;
		return { ...(payload as object), service_tier: "priority" };
	});

	pi.on("message_end", ({ message }, ctx) => {
		if (message.role !== "assistant") return;
		const real = requestedFast;
		requestedFast = undefined;
		if (!real || message.provider !== PROVIDER || message.model !== real) return;
		const model = realModel(ctx, real);

		// Rebase on token counts: pi may already have applied a provider tier multiplier.
		const usage = { ...message.usage };
		const base = calculateCost(model, usage);
		usage.cost = {
			input: base.input * FAST_RATE,
			output: base.output * FAST_RATE,
			cacheRead: base.cacheRead * FAST_RATE,
			cacheWrite: base.cacheWrite * FAST_RATE,
			total: 0,
		};
		usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
		return { message: { ...message, usage } };
	});
}
