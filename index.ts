import { calculateCost, getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionVirtualModel } from "@earendil-works/pi-coding-agent";

const PROVIDER = "openai-codex";
const REAL = "gpt-6.1-sol";
const FAST = `${REAL}-fast`;
const ALLOWANCE_MULTIPLIER = 2.5;

export default function (pi: ExtensionAPI) {
	let pendingModel: Model<Api> | undefined;

	const definition: ExtensionVirtualModel = {
		provider: PROVIDER,
		id: FAST,
		name: "GPT-6.1 Sol Fast",
		thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
		route(request, ctx) {
			const model = ctx.modelRegistry.find(PROVIDER, REAL);
			if (!model) throw new Error(`pi-fast-models: ${PROVIDER}/${REAL} is missing. Update pi's model catalog.`);
			return { model, thinkingLevel: request.thinkingLevel };
		},
	};

	// Register before startup model selection; live metadata is available at session_start.
	pi.registerVirtualModel(definition);
	pi.on("session_start", (_event, ctx) => {
		pendingModel = undefined;
		const model = ctx.modelRegistry.find(PROVIDER, REAL);
		if (!model) throw new Error(`pi-fast-models: ${PROVIDER}/${REAL} is missing. Update pi's model catalog.`);
		pi.registerVirtualModel({
			...definition,
			thinkingLevels: getSupportedThinkingLevels(model),
			contextWindow: model.contextWindow,
			maxTokens: model.maxTokens,
			input: model.input,
		});
	});

	pi.on("turn_start", () => { pendingModel = undefined; });
	pi.on("before_provider_request", (event, ctx) => {
		if (ctx.model?.provider !== PROVIDER || ctx.model.id !== FAST) return;
		const payload = event.payload as Record<string, unknown>;
		if (payload.model !== REAL) return;
		const model = ctx.modelRegistry.find(PROVIDER, REAL);
		if (!model) throw new Error(`pi-fast-models: ${PROVIDER}/${REAL} disappeared before its request.`);
		pendingModel = model;
		// This Codex endpoint accepts priority, not the CLI's fast spelling.
		return { ...payload, service_tier: "priority" };
	});

	pi.on("message_end", ({ message }) => {
		if (message.role !== "assistant") return;
		const model = pendingModel;
		pendingModel = undefined;
		if (!model || message.provider !== PROVIDER || message.model !== REAL) return;

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
