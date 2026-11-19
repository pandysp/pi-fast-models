import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
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
const REALS = ["gpt-6.2-sol", "gpt-6.2-astra"];

writeFileSync(doubled, `export default function(pi) {
  pi.on("message_end", ({message}, ctx) => {
    if (message.role !== "assistant" || !ctx.model?.id.endsWith("-fast")) return;
    const cost = Object.fromEntries(Object.entries(message.usage.cost).map(([k,v]) => [k,v*2]));
    return {message: {...message, usage: {...message.usage, cost}}};
  });
}`);
writeFileSync(observer, `import {appendFileSync} from "node:fs";
export default function(pi) {
  const log = (data) => appendFileSync(${JSON.stringify(log)}, JSON.stringify(data)+"\\n");
  pi.on("session_start", (_,ctx) => {
    const models = Object.fromEntries(${JSON.stringify(REALS)}.map(id => [id, {
      real: ctx.modelRegistry.find("openai-codex", id), fast: ctx.modelRegistry.find("openai-codex", id+"-fast")}]));
    log({type:"metadata", models, selected:ctx.model});
  });
  pi.on("before_provider_request", ({payload},ctx) => {
    log({type:"request", model:payload.model, tier:payload.service_tier,
      effort:payload.reasoning?.effort, selected:ctx.model.id});
  });
  // Another extension's direct model call, like a review head. before_provider_request doesn't see these.
  pi.on("agent_end", async (_,ctx) => {
    for (const id of ${JSON.stringify(REALS)}) {
      const model = ctx.modelRegistry.find("openai-codex", id);
      const message = await ctx.modelRegistry.streamSimple(model,
        {messages:[{role:"user", content:"Reply with only ok.", timestamp:Date.now()}]},
        {reasoning:"low", onPayload: p => log({type:"side", model:p.model, tier:p.service_tier})}).result();
      if (message.stopReason !== "stop") throw new Error("side call to "+id+" failed: "+message.errorMessage);
    }
  });
}`);

function run(realId, args, marker, expectFast, requireTool = false) {
  writeFileSync(log, "");
  const prompt = requireTool
    ? `Use bash to run printf '${marker}\\n', then reply with only ${marker}.`
    : `Reply with only ${marker}.`;
  const result = spawnSync("pi", [
    "--mode", "json", "--no-extensions", "--no-skills", "--no-prompt-templates",
    "--no-context-files", "--no-mcp", "--tools", "bash", "--thinking", "high",
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
    assert.equal(m.model, realId);
  }
  assert.equal(messages.at(-1).content.filter(c => c.type === "text").map(c => c.text).join("").trim(), marker);
  if (requireTool) assert.ok(messages.some(m => m.content.some(c => c.type === "toolCall" && c.name === "bash")));
  const records = jsonl(log);
  const { models, selected } = records.find(r => r.type === "metadata");
  for (const { real, fast } of Object.values(models)) {
    assert.equal(fast.contextWindow, real.contextWindow);
    assert.equal(fast.maxTokens, real.maxTokens);
    assert.ok(fast.contextWindow > 0);
    assert.deepEqual(fast.input, real.input);
  }
  const { real, fast } = models[realId];
  const requests = records.filter(r => r.type === "request");
  assert.equal(requests.length, messages.length, "unexpected retries or missing requests");
  const isFast = selected.id === `${realId}-fast`;
  assert.equal(isFast, expectFast, `selected ${selected.id}`);
  if (isFast) assert.equal(selected.contextWindow, real.contextWindow, "selected model's initial limits");
  for (const r of requests) {
    assert.equal(r.model, real.id);
    assert.equal(r.tier, isFast ? "priority" : undefined);
    assert.equal(r.effort, "high", "--thinking high must survive startup");
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
  // Only the selected fast model's real model gets priority, also for other extensions' calls.
  const side = records.filter(r => r.type === "side");
  assert.deepEqual(side.map(r => r.model), REALS, "extension calls");
  for (const r of side) assert.equal(r.tier, isFast && r.model === realId ? "priority" : undefined, `extension call to ${r.model}`);
  console.log(`${marker}: ${messages.length} ${realId} replies, ${isFast ? "priority / 2.5×" : "standard / 1×"}, extension calls ${side.map(r => `${r.model}:${r.tier ?? "standard"}`).join(" ")}, live limits ${fast.contextWindow}/${fast.maxTokens}`);
  return messages;
}

// Ctrl+P cycling, through RPC: the fast model must keep live limits each time it is selected. No model calls.
async function cycle(realId) {
  const pi = spawn("pi", ["--mode", "rpc", "--no-session", "--no-extensions", "-e", extension,
    "--models", `openai-codex/${realId}:high,openai-codex/${realId}-fast:high`, "--model", `openai-codex/${realId}`],
    { cwd: temp, stdio: ["pipe", "pipe", "inherit"] });
  const waiting = new Map();
  let id = 0;
  const failAll = error => { for (const { reject } of waiting.values()) reject(error); waiting.clear(); };
  pi.on("error", failAll);
  pi.on("exit", code => failAll(new Error(`pi rpc exited with ${code}`)));
  const deadline = setTimeout(() => pi.kill(), 60_000);
  createInterface({ input: pi.stdout }).on("line", line => {
    const msg = JSON.parse(line);
    if (msg.type !== "response") return;
    waiting.get(msg.id)?.resolve(msg);
    waiting.delete(msg.id);
  });
  const send = type => new Promise((resolve, reject) => {
    waiting.set(String(++id), { resolve, reject });
    pi.stdin.write(JSON.stringify({ id: String(id), type }) + "\n");
  });
  try {
    const real = (await send("get_state")).data.model;
    for (let i = 0; i < 4; i++) {
      assert.ok((await send("cycle_model")).success);
      const state = (await send("get_state")).data;
      assert.equal(state.model.id, i % 2 ? realId : `${realId}-fast`);
      assert.equal(state.model.contextWindow, real.contextWindow, `cycle ${i + 1}: ${state.model.id}`);
      assert.equal(state.model.maxTokens, real.maxTokens);
      assert.equal(state.thinkingLevel, "high");
    }
    console.log(`CYCLE_OK: 4 switches, ${realId}-fast keeps ${real.contextWindow}/${real.maxTokens}`);
  } finally {
    clearTimeout(deadline);
    pi.kill();
  }
}

try {
  for (const realId of REALS) await cycle(realId);
  const first = run("gpt-6.2-sol", ["--model", "openai-codex/gpt-6.2-sol-fast", "--session", session], "FAST_OK", true, true);
  const persisted = jsonl(session).filter(e => e.type === "message" && e.message.role === "assistant").map(e => e.message);
  assert.deepEqual(persisted.map(m => m.usage), first.map(m => m.usage), "persisted cost differs from displayed cost");
  run("gpt-6.2-sol", ["--session", session], "RESUME_OK", true);
  run("gpt-6.2-astra", ["--model", "openai-codex/gpt-6.2-astra-fast", "--no-session"], "ASTRA_FAST_OK", true);
  run("gpt-6.2-sol", ["--model", "openai-codex/gpt-6.2-sol", "--no-session"], "NORMAL_OK", false);
  console.log("PASS: model cycling, tool continuation, priority payload, extension calls, no double surcharge, persisted costs, resume, Astra fast, ordinary Sol unchanged");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
