# Fast benchmarks

<!-- 2026-11-22 03:14 UTC · pi session 01a20104-d448-7212-94ef-54264430e586 -->

Two matched tests on 2026-11-22 measured the wait for GPT-6.2 Astra and Sol in pi 1.6.0. Fast saved about 28% on the copy task for both models, and 22% on Astra / 35% on Sol for the counting task. This is latency on two workloads, not a speed guarantee or a measure of billing.

## Method

Baseline: [pi-fast-models v0.3.0](https://github.com/pandysp/pi-fast-models/tree/v0.3.0). Each block ran all four selections, one after the other, with an identical prompt within the block. The order rotated as shown below. Each call used a fresh, unsaved pi session with no tools, skills, context files, or unrelated extensions. Pi was set to `high`; all logged requests sent `medium` on the wire. The request hook verified the real model ID and priority on Fast only. Nothing here establishes which tier the server billed or delivered. All completed runs used one outbound request and had zero cache-read tokens.

- **Copy:** Ask for one line, copied exactly: the integers 100 through 334 joined by `, `. Require only that line, without commentary or Markdown. All 16 replies matched and pi reported 707 output tokens each. Time to first text starts at the outbound request hook; streaming runs from first to last text chunk; total runs from the hook to completion. The median streaming rates were about 43% higher for both models.
- **Counting:** Ask for the number of permutations of 9, 10, 11, or 12 labeled people (`A` onward) in a line with none of the unordered pairs `AB, BC, CD, DE, EA, FG, GH, HI` adjacent. The reply must be the exact integer only, with no commas, explanation, or Markdown. Expected answers were independently computed by bitmask dynamic programming and inclusion–exclusion. All 16 answers were correct, with no timeouts. Total time is measured from the first outbound attempt to the completed assistant response, including any retry wait. Token counts are pi's reported output usage, not a count of words in the final answer.

Median reductions compare each model's Fast and Standard medians. Fast finished sooner in all four matched blocks for each model on both tasks. With only four blocks per task, the results don't settle which model benefits more in general.

## Run-level measurements

Rows are in execution order. Times are in seconds. Model names omit `GPT-6.2`.

| Block | Selection | Copy: first text | Copy: streaming | Copy: total | Counting: answer | Counting: output tokens | Counting: total |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | Astra | 2.824 | 13.811 | 16.760 | 47600 | 238 | 9.233 |
| 1 | Astra Fast | 1.739 | 9.643 | 11.621 | 47600 | 227 | 6.889 |
| 1 | Sol Fast | 1.391 | 9.761 | 11.210 | 47600 | 222 | 6.128 |
| 1 | Sol | 1.545 | 13.953 | 15.544 | 47600 | 254 | 9.379 |
| 2 | Astra Fast | 4.967 | 9.647 | 14.839 | 586440 | 248 | 7.525 |
| 2 | Sol | 1.419 | 14.030 | 15.562 | 586440 | 283 | 11.800 |
| 2 | Astra | 2.217 | 13.788 | 16.066 | 586440 | 286 | 7.704 |
| 2 | Sol Fast | 1.281 | 9.765 | 11.104 | 586440 | 273 | 7.074 |
| 3 | Sol | 1.844 | 13.930 | 16.005 | 7669920 | 321 | 11.842 |
| 3 | Sol Fast | 1.682 | 9.490 | 11.243 | 7669920 | 395 | 11.005 |
| 3 | Astra Fast | 1.690 | 9.659 | 11.414 | 7669920 | 289 | 8.648 |
| 3 | Astra | 1.947 | 14.179 | 16.221 | 7669920 | 302 | 11.680 |
| 4 | Sol Fast | 1.346 | 9.781 | 11.212 | 106422240 | 349 | 8.323 |
| 4 | Astra | 2.284 | 13.777 | 16.125 | 106422240 | 291 | 11.305 |
| 4 | Sol | 1.506 | 13.937 | 15.494 | 106422240 | 340 | 14.078 |
| 4 | Astra Fast | 2.191 | 9.409 | 11.665 | 106422240 | 258 | 8.527 |

An earlier counting run stopped when its harness encountered two requests for one Sol call; none of that run is in the table. An offline replay of the saved two-request record verified that the corrected harness counts both attempts and measures from the first, not the last.

## Earlier measurements

On 2026-11-19, a raw request for about 700 output tokens, run six times per tier, streamed Astra 6.2 at 27.5 → 34.5 tokens/s (Standard → Fast), with total wait about 28 → 22 s. Sol 6.2 streamed at about 38 → 72 tokens/s in that session; a comparable total wait wasn't recorded. The larger streaming gain on Sol did not repeat in the matched copy test. An older GPT-6.1 Sol file-writing test (three alternating runs) took 44.8 → 38.7 s; it wasn't repeated on 6.2.
