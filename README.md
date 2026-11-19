# pi-fast-models

Adds `openai-codex/gpt-6.2-sol-fast` and `openai-codex/gpt-6.2-astra-fast` to [pi](https://pi.dev). Select them like any other model, or put them in your scoped models to use fast mode whenever you cycle to Sol or Astra. Normal Sol and Astra stay available.

Requires **pi 1.3.0 or later** and an OpenAI Codex login with access to GPT-6.2 Sol or Astra. Tested on pi 1.5.2 with a ChatGPT Pro login.

Version 0.3.0 adds `gpt-6.2-astra-fast`. It also sets the fast tier in a provider wrapper, so other extensions' requests get it too.

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

**The displayed dollar amount for fast replies is an allowance-adjusted estimate, not a bill.** The extension recalculates from token counts and the real model's base prices, then applies **2.5×**. It does not measure your remaining allowance or change billing.

OpenAI distinguishes [included subscription usage from purchased credits](https://help.openai.com/en/articles/20001106-codex-rate-card):

| Usage | Fast-mode multiplier |
| --- | --- |
| Included subscription allowance | 2.5× |
| Purchased credits | 2× |

The display always uses 2.5×. It therefore overstates the monetary surcharge if you pay with purchased credits. Ordinary Sol and Astra costs are untouched. Costs are saved in session history; `/session` groups both variants under the real model. Direct calls made by other extensions and compaction summaries use the fast tier but keep their normal cost display.

## How it works

Each virtual model routes to its live real model, `gpt-6.2-sol` or `gpt-6.2-astra`. The extension wraps pi's Codex transport. While a fast model is selected, the wrapper adds `service_tier: "priority"` to every request for its real model. That includes compaction and calls that other extensions make through pi, such as review heads. It doesn't matter whether those extensions load before or after pi-fast-models. The tested Codex endpoint rejects `"fast"` even though OpenAI's own CLI uses that spelling.

The model's context window, output limit and supported thinking levels come from the live catalog at session start, including your `models.json` overrides. Until then the model accepts every thinking level, so `--thinking high` at startup isn't lowered. Each request resolves the real model again. `pi --list-models` runs before session start and shows unknown limits (`0`) for the virtual entry. In a session the limits are filled in before the first request and again each time you switch to the fast model. Tests verify that switching preserves the live model limits. Automatic compaction and the context meter display have not been tested.

Other extensions that also change service tiers or costs can conflict. Use one fast-mode extension at a time.

Provider wrappers don't chain. If another extension also wraps the `openai-codex` transport, only the one loaded last runs. If pi-fast-models' wrapper was replaced, it reports an error at session start and fast requests fail. It can't see the other direction, when it replaces a wrapper loaded before it.

## Verification

```sh
npm ci
npm run check
npm test
```

The end-to-end test launches real pi processes and uses your Codex login. It consumes plan usage. It checks the sent model, tier and thinking level for Sol and Astra, live limits after switching models with Ctrl+P, a tool round trip, persisted costs, resuming the fast selection and ordinary Sol. It also checks that another extension's call to the real model gets the fast tier only while its fast model is selected, and that an existing provider surcharge isn't applied twice. Temporary test files are removed afterward.

In three alternating runs of a small file-writing task on GPT-6.1 Sol (not repeated for 6.2), the fast variant took **38.7 s** median versus **44.8 s** for ordinary Sol. On 2026-11-19 a raw request for about 700 output tokens, run six times each way, streamed GPT-6.2 Astra at a median of **34.5** tokens per second with priority and **27.5** without. The whole reply took about 22 s versus 28 s. In the same session GPT-6.2 Sol went from about 38 to 72 tokens per second. So Astra gains less than Sol. These are small speed tests, not a quality comparison or a speed guarantee. The server reports `service_tier: "default"` in its replies even for priority requests, so the speed difference is the only sign that the tier applies.

## License

MIT
