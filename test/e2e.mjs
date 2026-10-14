import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Real pi + real Codex. Requires a working openai-codex login; consumes plan usage.
const root = fileURLToPath(new URL("../", import.meta.url));
const extension = resolve(process.env.FAST_EXTENSION ?? join(root, "index.ts"));
const temp = mkdtempSync(join(tmpdir(), "pi-fast-models-"));
const log = join(temp, "requests.jsonl");
const session = join(temp, "session.jsonl");
const observer = join(temp, "observe.ts");
const doubled = join(temp, "double-native-cost.ts");
const jsonl = (path) => readFileSync(path, "utf8").trim().split("\n").map(JSON.parse);

writeFileSync(doubled, `export default function(pi) {
  pi.on("message_end", ({message}, ctx) => {
    if (message.role !== "assistant" || ctx.model?.id !== "gpt-6.1-sol-fast") return;
    const cost = Object.fromEntries(Object.entries(message.usage.cost).map(([k,v]) => [k,v*2]));
    return {message: {...message, usage: {...message.usage, cost}}};
  });
}`);
writeFileSync(observer, `import {appendFileSync} from "node:fs";
export default function(pi) {
  const log = (data) => appendFileSync(${JSON.stringify(log)}, JSON.stringify(data)+"\\n");
  pi.on("session_start", (_,ctx) => {
    const real = ctx.modelRegistry.find("openai-codex", "gpt-6.1-sol");
    const fast = ctx.modelRegistry.find("openai-codex", "gpt-6.1-sol-fast");
    log({type:"metadata", real, fast, selected:ctx.model});
  });
  pi.on("before_provider_request", ({payload},ctx) => {
    log({type:"request", model:payload.model, tier:payload.service_tier,
      selected:ctx.model.id});
  });
}`);

function run(args, marker, requireTool = false) {
  writeFileSync(log, "");
  const prompt = requireTool
    ? `Use bash to run printf '${marker}\\n', then reply with only ${marker}.`
    : `Reply with only ${marker}.`;
  const result = spawnSync("pi", [
    "--mode", "json", "--no-extensions", "--no-skills", "--no-prompt-templates",
    "--no-context-files", "--no-mcp", "--tools", "bash", "--thinking", "low",
    "-e", doubled, "-e", extension, "-e", observer, ...args, prompt,
  ], { cwd: temp, encoding: "utf8", timeout: 180_000, maxBuffer: 32 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "", "unexpected pi errors");
  const events = result.stdout.trim().split("\n").map(JSON.parse);
  const messages = events.filter(e => e.type === "message_end" && e.message.role === "assistant").map(e => e.message);
  assert.ok(messages.length > 0, "no assistant messages");
  for (const m of messages) {
    assert.ok(m.stopReason === "stop" || m.stopReason === "toolUse", m.errorMessage);
    assert.equal(m.provider, "openai-codex");
    assert.equal(m.model, "gpt-6.1-sol");
  }
  assert.equal(messages.at(-1).content.filter(c => c.type === "text").map(c => c.text).join("").trim(), marker);
  if (requireTool) assert.ok(messages.some(m => m.content.some(c => c.type === "toolCall" && c.name === "bash")));
  const records = jsonl(log);
  const { real, fast, selected } = records.find(r => r.type === "metadata");
  assert.equal(fast.contextWindow, real.contextWindow);
  assert.equal(fast.maxTokens, real.maxTokens);
  assert.ok(fast.contextWindow > 0);
  assert.deepEqual(fast.input, real.input);
  const requests = records.filter(r => r.type === "request");
  assert.equal(requests.length, messages.length, "unexpected retries or missing requests");
  const isFast = selected.id === "gpt-6.1-sol-fast";
  if (isFast) assert.equal(selected.contextWindow, real.contextWindow, "selected model's initial limits");
  for (const r of requests) {
    assert.equal(r.model, real.id);
    assert.equal(r.tier, isFast ? "priority" : undefined);
  }
  for (const m of messages) {
    let total = 0;
    for (const key of ["input", "output", "cacheRead", "cacheWrite"]) {
      const expected = m.usage[key] * real.cost[key] / 1e6 * (isFast ? 2.5 : 1);
      assert.ok(Math.abs(m.usage.cost[key] - expected) < 1e-12,
        `${key}: got ${m.usage.cost[key]}, expected ${expected}`);
      total += expected;
    }
    assert.ok(Math.abs(m.usage.cost.total - total) < 1e-12);
  }
  console.log(`${marker}: ${messages.length} replies, ${isFast ? "priority / 2.5×" : "standard / 1×"}, live limits ${fast.contextWindow}/${fast.maxTokens}`);
  return messages;
}

try {
  const first = run(["--model", "openai-codex/gpt-6.1-sol-fast", "--session", session], "FAST_OK", true);
  const persisted = jsonl(session).filter(e => e.type === "message" && e.message.role === "assistant").map(e => e.message);
  assert.deepEqual(persisted.map(m => m.usage), first.map(m => m.usage), "persisted cost differs from displayed cost");
  run(["--session", session], "RESUME_OK");
  run(["--model", "openai-codex/gpt-6.1-sol", "--no-session"], "NORMAL_OK");
  console.log("PASS: tool continuation, priority payload, no double surcharge, persisted costs, resume, ordinary Sol unchanged");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
