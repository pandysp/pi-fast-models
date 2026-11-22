import assert from 'node:assert/strict';
import { test } from 'node:test';
import fastModels from '../index.ts';

// No provider login. A replaying extension snapshots what earlier handlers returned.
for (const real of ['gpt-6.2-astra', 'gpt-6.2-sol']) {
  for (const fastFirst of [true, false]) test(`${real}: capture ${fastFirst ? 'after' : 'before'} tier hook`, () => {
    const handlers = [], models = [];
    const api = {
      registerVirtualModel: m => models.push(m),
      on: (event, fn) => { if (event === 'before_provider_request') handlers.push(fn); },
      // Deliberately no registerProvider: unrelated provider calls are outside this extension.
    };
    let captured;
    const capture = () => handlers.push(({payload}) => { captured = structuredClone(payload); });
    if (!fastFirst) capture();
    fastModels(api);
    if (fastFirst) capture();
    assert.ok(models.some(m => m.id === `${real}-fast`));
    for (const [id,provider,body,expectFast] of [
      [`${real}-fast`,'openai-codex',real,true], [real,'openai-codex',real,false],
      [`${real}-fast`,'other',real,false], [`${real}-fast`,'openai-codex','different-model',false],
    ]) {
      let payload = {model: body};
      for (const fn of handlers) payload = fn({payload},{model:{id,provider}}) ?? payload;
      assert.equal(payload.service_tier, expectFast ? 'priority' : undefined);
      assert.equal(captured.service_tier, expectFast && fastFirst ? 'priority' : undefined);
    }
  });
}
