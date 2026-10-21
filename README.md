# pi-fast-models

Adds `openai-codex/gpt-6.1-sol-fast` to [pi](https://pi.dev). Select it like any other model, or put it in your scoped models to use fast mode whenever you cycle to Sol. Normal Sol stays available.

Requires **pi 1.3.0 or later** and an OpenAI Codex login with access to GPT-6.1 Sol. Tested on pi 1.3.0 with a ChatGPT Pro login.

## Install

```sh
pi install npm:pi-fast-models
```

Start a new pi session or run `/reload`. Select `openai-codex/gpt-6.1-sol-fast` through `/model`, or try:

```sh
pi --model openai-codex/gpt-6.1-sol-fast --thinking high -p "Reply with just: ok"
```

To keep fast mode in your model cycle, replace Sol's entry in `~/.pi/agent/settings.json` → `enabledModels`:

```json
"openai-codex/gpt-6.1-sol-fast:high"
```

If you set `compaction.modelOverrides` for Sol, copy it to the fast ID too. Pi looks overrides up by the selected model.

No `/fast` command or separate configuration. Only Sol is included; Astra and Anthropic models are unchanged.

## Cost display

**The displayed dollar amount for fast replies is an allowance-adjusted estimate, not a bill.** The extension recalculates from token counts and the real model's base prices, then applies **2.5×**. It does not measure your remaining allowance or change billing.

OpenAI distinguishes [included subscription usage from purchased credits](https://help.openai.com/en/articles/20001106-codex-rate-card):

| Usage | Fast-mode multiplier |
| --- | --- |
| Included subscription allowance | 2.5× |
| Purchased credits | 2× |

The display always uses 2.5×. It therefore overstates the monetary surcharge if you pay with purchased credits. Ordinary Sol's costs are untouched. Costs are saved in session history; `/session` groups both variants under the real Sol model. Direct calls made by other extensions and compaction summaries are outside this reply-cost adjustment.

## How it works

Pi's virtual model routes to the live `gpt-6.1-sol`. The request hook adds `service_tier: "priority"`. The tested Codex endpoint rejects `"fast"` even though OpenAI's own CLI uses that spelling.

The model's context window, output limit and supported thinking levels come from the live catalog at session start, including your `models.json` overrides. Until then the model accepts every thinking level, so `--thinking high` at startup isn't lowered. Each request resolves the real model again. `pi --list-models` runs before session start and shows unknown limits (`0`) for the virtual entry. In a session the limits are filled in before the first request and again each time you switch to the fast model. Tests verify that switching preserves the live model limits. Automatic compaction and the context meter display have not been tested.

Other extensions that also change service tiers or costs can conflict. Use one fast-mode extension at a time.

## Verification

```sh
npm ci
npm run check
npm test
```

The end-to-end test launches real pi processes and uses your Codex login. It consumes plan usage. It checks the sent model, tier and thinking level, live limits after switching models with Ctrl+P, a tool round trip, persisted costs, resuming the fast selection and ordinary Sol. It also checks that an existing provider surcharge isn't applied twice. Temporary test files are removed afterward.

In three alternating runs of a small file-writing task, the fast variant took **38.7 s** median versus **44.8 s** for ordinary Sol. This is a small speed test, not a quality comparison or a speed guarantee. The server reports `service_tier: "default"` in its replies even for priority requests, so the speed difference is the only sign that the tier applies.

## License

MIT
