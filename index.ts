import { calculateCost, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { openAICodexResponsesApi } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionContext, ExtensionVirtualModel, ProviderConfig } from "@earendil-works/pi-coding-agent";

const PROVIDER = "openai-codex";
// Each real model gets a `-fast` twin.
const REAL_NAMES: Record<string, string> = {
	"gpt-6.2-sol": "GPT-6.2 Sol",
	"gpt-6.2-astra": "GPT-6.2 Astra",
};
const FAST_TO_REAL = new Map(Object.keys(REAL_NAMES).map(real => [`${real}-fast`, real]));
const ALLOWANCE_MULTIPLIER = 2.5;

function realModel(ctx: ExtensionContext, id: string) {
	const model = ctx.modelRegistry.find(PROVIDER, id);
	if (!model) throw new Error(`pi-fast-models: ${PROVIDER}/${id} is missing. Update pi's model catalog.`);
	return model;
}

export default function (pi: ExtensionAPI) {
	// Real model ID behind the selected fast model; undefined when no fast model is selected.
	let selectedReal: string | undefined;
	const select = (model: { provider: string; id: string } | undefined) => {
		selectedReal = model?.provider === PROVIDER ? FAST_TO_REAL.get(model.id) : undefined;
	};

	const definitions = [...FAST_TO_REAL].map(([fast, real]): ExtensionVirtualModel => ({
		provider: PROVIDER,
		id: fast,
		name: `${REAL_NAMES[real]} Fast`,
		// Startup resolves --thinking before session_start; without this pi would clamp "high" to "low".
		thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
		route(request, ctx) {
			assertWrapper(ctx);
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

	// Wrap pi's own Codex transport. Unlike before_provider_request, a provider wrapper also sees
	// compaction and other extensions' ctx.modelRegistry.streamSimple calls.
	const codex = openAICodexResponsesApi().streamSimple;
	if (typeof codex !== "function") throw new Error("pi-fast-models: pi-ai has no Codex streamSimple transport.");
	const streamSimple: NonNullable<ProviderConfig["streamSimple"]> = (model, context, options) =>
		codex(model as Parameters<typeof codex>[0], context, {
			...options,
			// Add the tier first so the caller's hooks (before_provider_request) see the real payload.
			onPayload: async (payload, m) => {
				const body = payload as Record<string, unknown>;
				// This Codex endpoint accepts priority, not the CLI's fast spelling.
				const tiered = selectedReal !== undefined && body.model === selectedReal ? { ...body, service_tier: "priority" } : body;
				return options?.onPayload ? ((await options.onPayload(tiered, m)) ?? tiered) : tiered;
			},
		});
	// Omitting oauth and models keeps pi's Codex login and model list.
	pi.registerProvider(PROVIDER, { api: "openai-codex-responses", streamSimple });

	// Provider wrappers don't chain: a later registerProvider("openai-codex", { streamSimple }) replaces this one.
	// Checked at session start and on every fast request, which then fails instead of running without priority.
	function assertWrapper(ctx: ExtensionContext) {
		if (ctx.modelRegistry.getRegisteredProviderConfig(PROVIDER)?.streamSimple !== streamSimple) {
			throw new Error(`pi-fast-models: another extension replaced the ${PROVIDER} transport, so fast mode would not apply. Use one of them.`);
		}
	}

	pi.on("session_start", (_event, ctx) => {
		assertWrapper(ctx);
		for (const definition of definitions) syncMetadata(ctx, definition);
		select(ctx.model);
	});
	pi.on("model_select", ({ model }, ctx) => {
		select(model);
		// Pi keeps the startup copy in its Ctrl+P list, so cycling back would restore 0 limits.
		const definition = definitions.find(d => model.provider === PROVIDER && d.id === model.id);
		if (definition) syncMetadata(ctx, definition);
	});

	pi.on("message_end", ({ message }, ctx) => {
		if (message.role !== "assistant" || message.provider !== PROVIDER || message.model !== selectedReal) return;
		const model = realModel(ctx, selectedReal);

		// Rebase on token counts: pi may already have applied a provider tier multiplier.
		const usage = { ...message.usage };
		const base = calculateCost(model, usage);
		usage.cost = {
			input: base.input * ALLOWANCE_MULTIPLIER,
			output: base.output * ALLOWANCE_MULTIPLIER,
			cacheRead: base.cacheRead * ALLOWANCE_MULTIPLIER,
			cacheWrite: base.cacheWrite * ALLOWANCE_MULTIPLIER,
			total: 0,
		};
		usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
		return { message: { ...message, usage } };
	});
}
