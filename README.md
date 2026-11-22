# pi-fast-models

Adds `openai-codex/gpt-6.2-sol-fast` and `openai-codex/gpt-6.2-astra-fast` to [pi](https://pi.dev). Select them like any other model, or put them in your scoped models to use fast mode whenever you cycle to Sol or Astra. Normal Sol and Astra stay available.

Requires **pi 1.3.0 or later** and an OpenAI Codex login with access to GPT-6.2 Sol or Astra. Tested on pi 1.6.0 with a ChatGPT Pro login.

Version 0.3.0 adds `gpt-6.2-astra-fast`. Both GPT-6.2 fast aliases now show a 2× requested-Fast cost estimate instead of 2.5×.

Version 0.2.0 moved from GPT-6.1 Sol to GPT-6.2 Sol: `gpt-6.1-sol-fast` is gone. Stay on `pi-fast-models@0.1.3` if you need it.

## Install

```sh
pi install npm:pi-fast-models
```

Start a new pi session or run `/reload`. Select `openai-codex/gpt-6.2-sol-fast` or `openai-codex/gpt-6.2-astra-fast` through `/model`, or try:

```sh
pi --model openai-codex/gpt-6.2-sol-fast --thinking high -p "Reply with just: ok"
```

To keep fast mode in your model cycle, replace the model's entry in `~/.pi/agent/settings.json` → `enabledModels`:

```json
"openai-codex/gpt-6.2-sol-fast:high",
"openai-codex/gpt-6.2-astra-fast:high"
```

If you set `compaction.modelOverrides` for Sol or Astra, copy it to the fast ID too. Pi looks overrides up by the selected model.

No `/fast` command or separate configuration. Only GPT-6.2 Sol and Astra are included. Other models are unchanged.

## Cost display

**This is an estimate at the requested Fast rate, not an observed debit.** [OpenAI’s speed multipliers](https://learn.chatgpt.com/docs/pricing) list Fast at **2× Standard** for GPT-6.2 Astra and Sol, for both included usage and purchased credits. The older 2.5× included-usage rate applied to earlier model generations. The extension recalculates each fast reply from its token counts and the real model’s base prices, then applies 2× once. It doesn’t read your balance or verify which tier the server billed.

Normal replies are unchanged. The estimate is saved in session history under the real model. Compaction summaries and direct calls by other extensions are outside this reply-cost adjustment.

## How it works

Each alias routes to its real Codex model. The `before_provider_request` hook adds `service_tier: "priority"` to matching driver requests. The extension does not wrap the Codex provider or opt unrelated calls into Fast.

**With pi-hydra:** put `pi-fast-models` **before** `pi-hydra` in the `packages` array in `~/.pi/agent/settings.json`, using your existing package sources. Register each only once. Hydra snapshots the driver payload in its own hook and replays it for heads. With this order, heads inherit priority; in the opposite order they miss the tier even though the driver still requests it. Other direct provider calls do not automatically inherit the driver’s tier.

The model's context window, output limit and supported thinking levels come from the live catalog at session start, including your `models.json` overrides. The alias preserves pi’s thinking-level selection at startup. Each request resolves the real model again. `pi --list-models` runs before session start and shows unknown limits (`0`) for the virtual entry. In a session the limits are filled in before the first request and again each time you switch to the fast model. Tests verify that switching preserves the live model limits. Automatic compaction and the context meter display have not been tested.

Other extensions that also change service tiers or costs can conflict. Use one fast-mode extension at a time.

## Verification

```sh
npm ci
npm run check
npm run test:offline
npm test
```

The end-to-end test launches real pi processes and uses your Codex login. It consumes plan usage. It checks the sent model, tier and thinking level for Sol and Astra, live limits after switching models with Ctrl+P, a tool round trip, persisted costs, resuming the fast selection and ordinary Sol. The offline tests check the tier seen by observers before and after the hook. The live test also checks that an existing provider surcharge is not applied twice. Temporary test files are removed afterward.

## How much faster?

| Task | Astra: less median wait | Sol: less median wait |
| --- | ---: | ---: |
| Copy fixed text | 28% | 28% |
| Solve a counting problem | 22% | 35% |

Fast won all four matched runs for each model on both tasks. These were small tests without tools, not a speed guarantee. [Method, run-level data, and earlier results](https://github.com/pandysp/pi-fast-models/blob/main/docs/benchmarks.md).

<!-- 2026-11-22 03:14 UTC · pi session 01a20104-d448-7212-94ef-54264430e586 -->

## License

MIT
