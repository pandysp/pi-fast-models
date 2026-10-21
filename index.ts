import { calculateCost, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ExtensionVirtualModel } from "@earendil-works/pi-coding-agent";

const PROVIDER = "openai-codex";
const REAL = "gpt-6.1-sol";
const FAST = `${REAL}-fast`;
const ALLOWANCE_MULTIPLIER = 2.5;

function realModel(ctx: ExtensionContext) {
	const model = ctx.modelRegistry.find(PROVIDER, REAL);
	if (!model) throw new Error(`pi-fast-models: ${PROVIDER}/${REAL} is missing. Update pi's model catalog.`);
	return model;
}

export default function (pi: ExtensionAPI) {
	let pendingFast = false;

	const definition: ExtensionVirtualModel = {
		provider: PROVIDER,
		id: FAST,
		name: "GPT-6.1 Sol Fast",
		// Startup resolves --thinking before session_start; without this pi would clamp "high" to "low".
		thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
		route(request, ctx) {
			return { model: realModel(ctx), thinkingLevel: request.thinkingLevel };
		},
	};

	// Register before startup model selection; live metadata is available at session_start.
	pi.registerVirtualModel(definition);
	pi.on("session_start", (_event, ctx) => {
		pendingFast = false;
		const model = realModel(ctx);
		pi.registerVirtualModel({
			...definition,
			thinkingLevels: getSupportedThinkingLevels(model),
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
			input: model.input,
		});
	});

	pi.on("turn_start", () => {
		pendingFast = false;
	});
	pi.on("before_provider_request", (event, ctx) => {
		if (ctx.model?.provider !== PROVIDER || ctx.model.id !== FAST) return;
		const payload = event.payload as Record<string, unknown>;
		if (payload.model !== REAL) return;
		pendingFast = true;
		// This Codex endpoint accepts priority, not the CLI's fast spelling.
		return { ...payload, service_tier: "priority" };
	});

	pi.on("message_end", ({ message }, ctx) => {
		if (message.role !== "assistant") return;
		const wasFast = pendingFast;
		pendingFast = false;
		if (!wasFast || message.provider !== PROVIDER || message.model !== REAL) return;
		const model = realModel(ctx);

		// Rebase on token counts: pi may already have applied a provider tier multiplier.
		const usage = { ...message.usage, cost: { ...message.usage.cost } };
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
