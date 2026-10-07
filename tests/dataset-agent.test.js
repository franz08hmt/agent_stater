import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { loadTaskConfig } from '../config/task.config.js';
import { createScriptedModel } from '../src/model/mock.js';
import { ROOT, LIMITS, tool, final } from './helpers.js';

async function setup(t, replies, notesTask = false) {
  const dir = await mkdtemp(join(tmpdir(), 'dataset-agent-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const task = await loadTaskConfig({ root: ROOT, ...(notesTask ? {} : { file: join(ROOT, 'config/datasets-demo.task.json') }) });
  const model = createScriptedModel(replies);
  const app = await createApp({ config: { model: { timeoutMs: 2000 }, limits: LIMITS, server: { maxBodyBytes: 16384 } }, model, task, varDir: dir, publicDir: join(ROOT, 'public') });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => app.server.close(resolve)));
  return { ...app, model, base: `http://127.0.0.1:${app.server.address().port}` };
}
function observation(messages) {
  const last = messages.findLast((m) => m.content.startsWith('OBSERVATION'));
  return JSON.parse(last.content.slice(last.content.indexOf('{')));
}
async function run(h, goal) {
  const res = await fetch(`${h.base}/api/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal }) });
  assert.equal(res.status, 202);
  const { run: started } = await res.json();
  await h.runner.idle(started.run_id);
  return (await (await fetch(`${h.base}/api/runs/${started.run_id}`)).json()).run;
}

for (const [dataset, args, value] of [
  ['products', { operation: 'sum', field: 'price', filters: [{ field: 'category', op: 'eq', value: 'stationery' }] }, '30.30'],
  ['classes', { operation: 'count', filters: [{ field: 'day', op: 'eq', value: 'Mon' }] }, 2],
]) test(`HTTP Agent: scripted proposal -> backend -> ${dataset} observation -> final with source`, async (t) => {
  let evidence;
  const h = await setup(t, [
    (messages) => {
      assert.match(messages[0].content, /query_dataset/);
      assert.match(messages[0].content, /products/);
      assert.match(messages[0].content, /classes/);
      assert.ok(!messages[0].content.includes('data/datasets/'));
      return tool('query_dataset', { dataset_id: dataset, ...args });
    },
    (messages) => {
      const obs = observation(messages);
      assert.equal(obs.status, 'ok');
      evidence = obs.untrusted_data.results[0];
      assert.equal(evidence.value, value);
      assert.match(evidence.dataset_version, /^[a-f0-9]{64}$/);
      assert.equal(evidence.query.operation, args.operation);
      return final(`Calculated result: ${evidence.value}`, [evidence.source_id]);
    },
  ]);
  const result = await run(h, `Calculate ${dataset} using configured data.`);
  assert.equal(result.status, 'completed');
  assert.equal(result.steps_used, 1);
  assert.equal(result.repairs_used, 0);
  assert.deepEqual(result.final.source_ids, [evidence.source_id]);
  assert.deepEqual(result.retrieved_source_ids, [evidence.source_id]);
  assert.equal(result.trace.find((entry) => entry.kind === 'tool').status, 'ok');
  assert.deepEqual(result.approvals, []);
  assert.deepEqual(await h.store.listDrafts(), []);
  assert.equal(h.model.calls.length, 2);
});

test('Agent rejects a model-selected dataset outside the allow-list before any result is returned', async (t) => {
  const h = await setup(t, [tool('query_dataset', { dataset_id: 'secret', operation: 'count' }), (messages) => {
    const obs = observation(messages);
    assert.equal(obs.status, 'rejected');
    assert.equal(obs.code, 'rule_violation');
    assert.equal(obs.untrusted_data, undefined);
    return final('Dataset unavailable.', [], 'Dataset is not allowed.');
  }]);
  const result = await run(h, 'Read a secret dataset.');
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.retrieved_source_ids, []);
  assert.equal(result.trace.find((entry) => entry.kind === 'tool').status, 'rejected');
});

test('existing notes task rejects query_dataset at the tool allow-list', async (t) => {
  const h = await setup(t, [tool('query_dataset', { dataset_id: 'products', operation: 'count' }), (messages) => {
    assert.equal(observation(messages).code, 'tool_not_allowed');
    return final('Tool unavailable.', [], 'Tool is disabled in this task.');
  }], true);
  const result = await run(h, 'Read products.');
  assert.deepEqual(result.retrieved_source_ids, []);
});

test('Agent grounding rejects an invented dataset citation and repairs the final', async (t) => {
  let source;
  const h = await setup(t, [tool('query_dataset', { dataset_id: 'products', operation: 'count' }), (messages) => {
    source = observation(messages).untrusted_data.results[0].source_id;
    return final('There are four products.', ['fabricated']);
  }, (messages) => {
    assert.match(messages.at(-1).content, /not retrieved/);
    return final('There are four products.', [source]);
  }]);
  const result = await run(h, 'Count products.');
  assert.equal(result.status, 'completed');
  assert.equal(result.repairs_used, 1);
  assert.deepEqual(result.final.source_ids, [source]);
});
