import { calculateCost, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ExtensionVirtualModel } from "@earendil-works/pi-coding-agent";

const PROVIDER = "openai-codex";
const MODELS = [
	{ real: "gpt-6.1-sol", name: "GPT-6.1 Sol Fast" },
	{ real: "gpt-6-astra", name: "GPT-6 Astra Fast" },
];
const ALLOWANCE_MULTIPLIER = 2.5;

const fastId = (real: string) => `${real}-fast`;

function realModel(ctx: ExtensionContext, id: string) {
	const model = ctx.modelRegistry.find(PROVIDER, id);
	if (!model) throw new Error(`pi-fast-models: ${PROVIDER}/${id} is missing. Update pi's model catalog.`);
	return model;
}

export default function (pi: ExtensionAPI) {
	let pendingFast = false;

	const definition = (real: string, name: string): ExtensionVirtualModel => ({
		provider: PROVIDER,
		id: fastId(real),
		name,
		// Startup resolves --thinking before session_start; without this pi would clamp "high" to "low".
		thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
		route(request, ctx) {
			return { model: realModel(ctx, real), thinkingLevel: request.thinkingLevel };
		},
	});

	// Copy live limits and levels onto a fast model; re-registering also refreshes the selected model.
	function syncMetadata(ctx: ExtensionContext, { real, name }: (typeof MODELS)[number]) {
		const model = realModel(ctx, real);
		pi.registerVirtualModel({
			...definition(real, name),
			thinkingLevels: getSupportedThinkingLevels(model),
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
			input: model.input,
		});
	}

	// Register before startup model selection; live metadata is available at session_start.
	for (const { real, name } of MODELS) pi.registerVirtualModel(definition(real, name));
	pi.on("session_start", (_event, ctx) => {
		for (const fast of MODELS) syncMetadata(ctx, fast);
	});
	// Pi keeps the startup copy in its Ctrl+P list, so cycling back would restore 0 limits.
	pi.on("model_select", ({ model }, ctx) => {
		const fast = MODELS.find((m) => fastId(m.real) === model.id);
		if (model.provider === PROVIDER && fast) syncMetadata(ctx, fast);
	});

	pi.on("turn_start", () => {
		pendingFast = false;
	});
	pi.on("before_provider_request", (event, ctx) => {
		if (ctx.model?.provider !== PROVIDER) return;
		const fast = MODELS.find((m) => fastId(m.real) === ctx.model?.id);
		const payload = event.payload as Record<string, unknown>;
		if (!fast || payload.model !== fast.real) return;
		pendingFast = true;
		// This Codex endpoint accepts priority, not the CLI's fast spelling.
		return { ...payload, service_tier: "priority" };
	});

	pi.on("message_end", ({ message }, ctx) => {
		if (message.role !== "assistant") return;
		const wasFast = pendingFast;
		pendingFast = false;
		if (!wasFast || message.provider !== PROVIDER || !MODELS.some((m) => m.real === message.model)) return;
		const model = realModel(ctx, message.model);

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
