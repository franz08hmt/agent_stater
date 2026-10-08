import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { harness, tool, final as decisionFinal, LIMITS, TASK } from './helpers.js';
import { createOpenAICompatibleModel } from '../src/model/openaiCompatible.js';
import { createAgentRunner } from '../src/agent/runner.js';
import { createToolRegistry } from '../src/tools/registry.js';
import { estimateInput } from '../src/agent/metrics.js';
import { createScriptedModel } from '../src/model/mock.js';
const final = (answer, sources = []) => decisionFinal(answer, sources, sources.length ? '' : 'No source requested in this accounting fixture.');

async function provider(t, replies, options = {}) {
  const bodies = [];
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    bodies.push(JSON.parse(raw));
    const reply = replies[bodies.length - 1] ?? { text: final('Done') };
    reply.onReceived?.();
    if (reply.waitFor) await reply.waitFor;
    if (reply.delay) await new Promise((r) => setTimeout(r, reply.delay));
    if (reply.disconnect) { req.socket.destroy(); return; }
    res.writeHead(reply.status ?? 200, { 'content-type': 'application/json' });
    if (reply.bodyDelay) { res.flushHeaders(); await new Promise((r) => setTimeout(r, reply.bodyDelay)); }
    res.end(JSON.stringify(reply.status ? { error: 'temporary', usage: reply.usage } : { choices: [{ message: { content: reply.text } }], usage: reply.usage }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const model = createOpenAICompatibleModel({ name: 'fake-http', baseUrl: `http://127.0.0.1:${server.address().port}/v1/`, maxOutputTokens: 100, temperature: 0, ...options });
  return { model, bodies };
}
const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
async function setup(t, replies, limits = {}, options = {}) {
  const p = await provider(t, replies);
  const h = await harness({ model: p.model, limits, ...options });
  t.after(h.cleanup);
  return { ...h, ...p };
}

test('HTTP usage accumulates across repair; counters distinguish calls, requests and steps', async (t) => {
  const h = await setup(t, [{ text: 'bad JSON', usage }, { text: tool('search_notes', { query: '401 403' }), usage }, { text: final('Done', ['http-status']), usage }]);
  const r = await h.run('401 403');
  assert.equal(r.status, 'completed');
  assert.equal(r.metrics.model_calls, 3); assert.equal(r.metrics.provider_requests, 3);
  assert.equal(r.metrics.repairs, 1); assert.equal(r.metrics.retries, 0); assert.equal(r.steps_used, 1);
  assert.deepEqual(r.metrics.tokens.reported, { input: 30, output: 15, total: 45 });
  assert.equal(r.metrics.tokens.budget_used, 45);
  assert.ok(r.metrics.model_ms >= r.metrics.provider_ms);
  assert.equal((await h.store.loadRuns())[0].metrics.provider_requests, 3);
});

test('missing and partial usage are reservations, not zero reported tokens', async (t) => {
  const h = await setup(t, [{ text: 'bad' }, { text: final('Done'), usage: { total_tokens: 20 } }]);
  const r = await h.run('test');
  assert.equal(r.metrics.tokens.reported.total, null);
  assert.equal(r.metrics.tokens.unavailable_requests, 2); assert.equal(r.metrics.tokens.invalid_usage_requests, 1);
  assert.equal(r.metrics.tokens.status, 'estimated'); assert.ok(r.metrics.tokens.budget_used > 0);
});

test('a retry is another HTTP request, not another model call', async (t) => {
  const h = await setup(t, [{ status: 503 }, { text: final('Done'), usage }]);
  const r = await h.run('test');
  assert.equal(r.status, 'completed'); assert.equal(h.bodies.length, 2);
  assert.equal(r.metrics.model_calls, 1); assert.equal(r.metrics.provider_requests, 2); assert.equal(r.metrics.retries, 1);
  assert.equal(r.metrics.tokens.status, 'mixed');
});

test('retry is blocked inside adapter when the hard request budget is exhausted', async (t) => {
  const h = await setup(t, [{ status: 503 }, { text: final('Done') }], { maxProviderRequests: 1 });
  const r = await h.run('test');
  assert.equal(h.bodies.length, 1); assert.equal(r.status, 'stopped'); assert.equal(r.failure.code, 'request_budget');
  assert.equal(r.metrics.retries, 0); assert.equal(r.metrics.provider_requests, 1);
});

test('request ceiling blocks repair before complete starts and preserves executed tools', async (t) => {
  const h = await setup(t, [{ text: tool('search_notes', { query: '401 403' }), usage }, { text: 'bad', usage }, { text: final('Done') }], { maxProviderRequests: 2 });
  const r = await h.run('401 403');
  assert.equal(h.bodies.length, 2); assert.equal(r.metrics.model_calls, 2); assert.equal(r.metrics.repairs, 0);
  assert.equal(r.status, 'stopped'); assert.equal(r.failure.code, 'request_budget'); assert.equal(r.steps_used, 1);
  assert.ok(r.retrieved_source_ids.includes('http-status'));
});

test('insufficient token reservation sends no request and starts no model call', async (t) => {
  const h = await setup(t, [{ text: final('Done') }], { tokenBudget: 64 });
  const r = await h.run('test');
  assert.equal(h.bodies.length, 0); assert.equal(r.metrics.model_calls, 0); assert.equal(r.failure.code, 'token_budget');
});

test('output cap can shrink for one request without changing configured cap', async (t) => {
  const h = await setup(t, [{ text: final('Done'), usage }]);
  await h.run('test');
  const input = estimateInput(h.bodies[0].messages);
  const small = await harness({ model: h.model, limits: { tokenBudget: input + 70 } }); t.after(small.cleanup);
  const r = await small.run('test');
  assert.equal(h.bodies[1].max_tokens, 70); assert.equal(r.status, 'completed');
  assert.equal(h.model.maxOutputTokens, 100);
});

test('failed and timed out HTTP requests still consume request and token reservations', async (t) => {
  for (const reply of [{ status: 429 }, { delay: 250, text: final('Late') }]) {
    const h = await setup(t, [reply], {}, { modelTimeoutMs: 80 });
    const r = await h.run('test');
    assert.equal(h.bodies.length, 1); assert.equal(r.metrics.provider_requests, 1);
    assert.equal(r.metrics.tokens.reported.total, null); assert.ok(r.metrics.tokens.budget_used > 0);
    assert.equal(r.status, 'failed'); assert.equal(r.metrics.retries, 0);
  }
});

const approvalReplies = [
  { text: tool('search_notes', { query: '401 403' }), usage },
  { text: tool('save_draft', { title: 'HTTP', content: '401 and 403', source_ids: ['http-status'] }), usage },
  { text: final('Saved', ['http-status']), usage },
];
test('approval wait, restart and replay preserve metrics and the original budget', async (t) => {
  const h = await setup(t, approvalReplies, { maxProviderRequests: 3 });
  let r = await h.run('save HTTP'); assert.equal(r.status, 'awaiting_approval');
  const beforeActive = r.active_ms;
  await new Promise((resolve) => setTimeout(resolve, 35));
  const restored = createAgentRunner({ model: h.model, registry: createToolRegistry(), retriever: h.retriever, store: h.store, limits: { ...LIMITS, maxProviderRequests: 1 }, modelTimeoutMs: 2000, task: TASK });
  await restored.init(); assert.equal(h.bodies.length, 2);
  r = restored.getRun(r.run_id); assert.equal(r.metrics.limits.provider_requests, 3); assert.equal(r.active_ms, beforeActive);
  assert.ok(r.metrics.approval_wait_ms >= 30);
  const a = r.approvals.at(-1); const args = { decision: 'approve', args_hash: a.args_hash };
  await restored.decideApproval(r.run_id, a.approval_id, args); await restored.idle(r.run_id);
  r = restored.getRun(r.run_id); assert.equal(r.status, 'completed'); assert.equal(r.metrics.provider_requests, 3);
  const snapshot = structuredClone(r.metrics);
  assert.equal((await restored.decideApproval(r.run_id, a.approval_id, args)).replayed, true);
  assert.deepEqual(restored.getRun(r.run_id).metrics, snapshot); assert.equal((await h.store.listDrafts()).length, 1);
  assert.ok(r.metrics.wall_ms >= r.metrics.active_ms + r.metrics.approval_wait_ms - 5);
});

test('budget stop on approval continuation writes nothing and replay sends nothing', async (t) => {
  const h = await setup(t, approvalReplies, { maxProviderRequests: 2 });
  const r = await h.run('save HTTP'); const a = r.approvals.at(-1);
  const args = { decision: 'approve', args_hash: a.args_hash };
  await h.runner.decideApproval(r.run_id, a.approval_id, args); await h.runner.idle(r.run_id);
  const stopped = h.runner.getRun(r.run_id);
  assert.equal(stopped.status, 'stopped'); assert.equal(stopped.failure.code, 'request_budget');
  assert.equal((await h.store.listDrafts()).length, 0); assert.equal(stopped.steps_used, 1);
  assert.equal((await h.runner.decideApproval(r.run_id, a.approval_id, args)).replayed, true);
  assert.equal(h.bodies.length, 2);
});

test('two runs have independent budgets; mock calls are explicitly not HTTP', async (t) => {
  const h = await setup(t, [{ text: final('One'), usage }, { text: final('Two'), usage }], { maxProviderRequests: 1 });
  const [one, two] = await Promise.all([h.run('one'), h.run('two')]);
  for (const r of [one, two]) { assert.equal(r.status, 'completed'); assert.equal(r.metrics.provider_requests, 1); }
  const mock = await harness({ replies: [final('Mock')] }); t.after(mock.cleanup);
  const r = await mock.run('test'); assert.equal(r.metrics.is_mock, true); assert.equal(r.metrics.model_calls, 1); assert.equal(r.metrics.provider_requests, 0);
});

test('legacy run is readable as not collected and does not rerun after restart', async (t) => {
  const h = await setup(t, [{ text: final('Done'), usage }]);
  const r = await h.run('test');
  const saved = (await h.store.loadRuns())[0]; delete saved.metrics; await h.store.saveRun(saved);
  await h.runner.init();
  assert.equal(h.runner.getRun(r.run_id).metrics.collection, 'not_collected');
  assert.equal(h.runner.getRun(r.run_id).metrics.provider_requests, null); assert.equal(h.bodies.length, 1);
});

test('network retry and cancellation during retry delay do not invent requests', async (t) => {
  const network = await setup(t, [{ disconnect: true }, { text: final('Done'), usage }]);
  const recovered = await network.run('test');
  assert.equal(recovered.status, 'completed'); assert.equal(network.bodies.length, 2);
  assert.equal(recovered.metrics.retries, 1); assert.equal(recovered.metrics.model_calls, 1);
  const cancelled = await setup(t, [{ status: 503 }, { text: final('Done') }], {}, { modelTimeoutMs: 100 });
  const r = await cancelled.run('test');
  assert.equal(r.failure.code, 'model_timeout'); assert.equal(cancelled.bodies.length, 1);
  assert.equal(r.metrics.retries, 0); assert.equal(r.metrics.provider_requests, 1);
});

test('token reservations also gate retries and failures are not free', async (t) => {
  const reference = await setup(t, [{ text: final('Done'), usage }]); await reference.run('test');
  const input = estimateInput(reference.bodies[0].messages);
  const h = await setup(t, [{ status: 503 }, { text: final('Done') }], { tokenBudget: input + 100 + input + 63 });
  const r = await h.run('test');
  assert.equal(r.failure.code, 'token_budget'); assert.equal(h.bodies.length, 1); assert.equal(r.metrics.model_calls, 1);
  assert.equal(r.metrics.tokens.budget_used, input + 100);
});

test('unexpectedly high reported usage stops before a proposed tool can execute', async (t) => {
  const h = await setup(t, [{ text: tool('search_notes', { query: '401' }), usage: { prompt_tokens: 99990, completion_tokens: 20, total_tokens: 100010 } }]);
  const r = await h.run('test');
  assert.equal(r.failure.code, 'token_budget'); assert.equal(r.steps_used, 0); assert.equal(r.trace.some((e) => e.kind === 'tool'), false);
});

test('in-flight request accounting is persisted; restart retains unknown reservation', { timeout: 10000 }, async (t) => {
  const response = Promise.withResolvers(), received = Promise.withResolvers();
  const saveEntered = Promise.withResolvers(), allowSave = Promise.withResolvers(), snapshotSaved = Promise.withResolvers();
  let h, started;
  t.after(async () => { allowSave.resolve(); response.resolve(); if (started) await h.runner.idle(started.run_id); });
  // Fixture deadline exceeds the TEST deadline, so only our response gate can
  // complete this request during the assertions. Production deadlines unchanged.
  h = await setup(t, [{ onReceived: received.resolve, waitFor: response.promise, text: final('Done'), usage }],
    { runMaxMs: 30000 }, { modelTimeoutMs: 20000 });
  const saveRun = h.store.saveRun;
  h.store.saveRun = async (run) => {
    const pending = run.metrics.provider_requests === 1 && run.metrics.tokens.pending_requests === 1;
    if (pending) { saveEntered.resolve(); await allowSave.promise; }
    await saveRun(run);
    if (pending) snapshotSaved.resolve(); // atomic rename has completed
  };
  started = await h.runner.startRun('test');
  await Promise.all([saveEntered.promise, received.promise]);
  assert.equal(h.bodies.length, 1, 'HTTP is actually in flight while persistence is held');
  assert.equal((await h.store.loadRuns())[0].metrics.provider_requests, 0, 'old snapshot until atomic save completes');
  allowSave.resolve(); await snapshotSaved.promise;
  const saved = (await h.store.loadRuns())[0];
  assert.equal(saved.metrics.provider_requests, 1); assert.equal(saved.metrics.tokens.pending_requests, 1);
  response.resolve();
  await h.runner.idle(started.run_id);
  await h.store.saveRun(saved); // simulate the last durable snapshot before a process died
  await h.runner.init();
  const restored = h.runner.getRun(started.run_id);
  assert.equal(restored.failure.code, 'interrupted'); assert.equal(restored.metrics.provider_requests, 1);
  assert.equal(restored.metrics.tokens.budget_used, saved.metrics.tokens.budget_used);
  assert.equal(restored.metrics.tokens.unavailable_requests, 1); assert.equal(restored.metrics.timing_incomplete, true);
  assert.equal(h.bodies.length, 1);
});

test('legacy pending approval cannot write using an unknown budget', async (t) => {
  const h = await setup(t, approvalReplies);
  const run = await h.run('save HTTP'); const saved = (await h.store.loadRuns())[0];
  delete saved.metrics; await h.store.saveRun(saved); await h.runner.init();
  const a = run.approvals.at(-1);
  const result = await h.runner.decideApproval(run.run_id, a.approval_id, { decision: 'approve', args_hash: a.args_hash });
  assert.equal(result.run.failure.code, 'metrics_unavailable'); assert.equal(result.run.status, 'stopped');
  assert.equal(h.bodies.length, 2); assert.equal((await h.store.listDrafts()).length, 0);
});

test('valid usage on failed HTTP or malformed response is retained without format retry', async (t) => {
  for (const reply of [{ status: 400, usage }, { usage }]) {
    const h = await setup(t, [reply]); const r = await h.run('test');
    assert.equal(r.status, 'failed'); assert.equal(h.bodies.length, 1);
    assert.equal(r.metrics.tokens.reported.total, 15); assert.equal(r.metrics.tokens.estimated.total, 0);
    assert.equal(r.metrics.retries, 0);
  }
});

test('approval cannot write when token reservation no longer fits', async (t) => {
  const h = await setup(t, approvalReplies); const r = await h.run('save HTTP');
  const saved = (await h.store.loadRuns())[0];
  saved.metrics.tokens.estimated.total = saved.metrics.limits.token_budget - saved.metrics.tokens.reported.total;
  saved.metrics.tokens.budget_used = saved.metrics.limits.token_budget;
  await h.store.saveRun(saved); await h.runner.init();
  const a = r.approvals.at(-1);
  const result = await h.runner.decideApproval(r.run_id, a.approval_id, { decision: 'approve', args_hash: a.args_hash });
  assert.equal(result.run.failure.code, 'token_budget'); assert.equal(result.run.steps_used, 1);
  assert.equal((await h.store.listDrafts()).length, 0); assert.equal(h.bodies.length, 2);
});

test('timeout while reading the response is still a counted request and model timeout', async (t) => {
  const h = await setup(t, [{ bodyDelay: 250, text: final('Late'), usage }], {}, { modelTimeoutMs: 80 });
  const r = await h.run('test');
  assert.equal(r.failure.code, 'model_timeout'); assert.equal(h.bodies.length, 1);
  assert.equal(r.metrics.provider_requests, 1); assert.equal(r.metrics.tokens.reported.total, null);
  assert.ok(r.metrics.tokens.budget_used > 0);
});

function restartRunner(h, model) {
  return createAgentRunner({ model, registry: createToolRegistry(), retriever: h.retriever, store: h.store,
    limits: { ...LIMITS, maxProviderRequests: 1 }, modelTimeoutMs: 2000, task: TASK });
}

for (const change of ['mock to HTTP', 'HTTP to mock', 'HTTP name', 'provider only', 'is_mock only']) {
  test(`restart cancels approval on model change: ${change}, retaining historical accounting`, async (t) => {
    const h = change === 'mock to HTTP'
      ? await harness({ replies: approvalReplies.map((r) => r.text), limits: { maxProviderRequests: 1 } })
      : await setup(t, approvalReplies);
    if (change === 'mock to HTTP') t.after(h.cleanup);
    const original = await h.run('save HTTP');
    assert.equal(original.status, 'awaiting_approval');
    const savedBefore = (await h.store.loadRuns())[0];
    const nextProvider = await provider(t, [{ status: 503 }, { text: final('Saved', ['http-status']), usage }], { name: change === 'HTTP name' ? 'other-http-model' : 'fake-http' });
    const nextMock = createScriptedModel([final('Saved', ['http-status'])]);
    const next = change === 'HTTP to mock' ? nextMock
      : change === 'provider only' ? { ...h.model, provider: 'different-provider' }
        : change === 'is_mock only' ? { ...h.model, isMock: true }
          : nextProvider.model;
    const restored = restartRunner(h, next);
    await restored.init();
    const r = restored.getRun(original.run_id);
    assert.equal(r.status, 'failed'); assert.equal(r.failure.code, 'model_changed');
    assert.equal(r.pending_approval, null); assert.equal(r.approvals.at(-1).state, 'cancelled');
    assert.deepEqual(r.model, original.model);
    for (const key of ['is_mock', 'limits', 'model_calls', 'provider_requests', 'repairs', 'retries', 'tokens', 'model_ms', 'provider_ms', 'active_ms']) {
      assert.deepEqual(r.metrics[key], savedBefore.metrics[key], `historical ${key} unchanged`);
    }
    const a = original.approvals.at(-1);
    await assert.rejects(restored.decideApproval(r.run_id, a.approval_id, { decision: 'approve', args_hash: a.args_hash }), { code: 'approval_already_decided' });
    assert.equal(nextProvider.bodies.length, 0, 'neither initial HTTP nor retry can reach provider');
    assert.equal(nextMock.calls.length, 0); assert.equal((await h.store.listDrafts()).length, 0);
    const stored = (await h.store.loadRuns())[0];
    assert.equal(stored.failure.code, 'model_changed'); assert.equal(stored.approvals.at(-1).state, 'cancelled');
    await restored.init(); // cancellation is durable and repeat init does not reclassify history
    assert.equal(restored.getRun(r.run_id).failure.code, 'model_changed');
    if (h.bodies) assert.equal(h.bodies.length, 2);
  });
}

test('unchanged mock identity can resume with a fresh model instance and replay safely', async (t) => {
  const h = await harness({ replies: approvalReplies.map((r) => r.text), limits: { maxProviderRequests: 1 } }); t.after(h.cleanup);
  const original = await h.run('save HTTP');
  const next = createScriptedModel([final('Saved', ['http-status'])]);
  const restored = restartRunner(h, next); await restored.init();
  const a = original.approvals.at(-1); const decision = { decision: 'approve', args_hash: a.args_hash };
  await restored.decideApproval(original.run_id, a.approval_id, decision); await restored.idle(original.run_id);
  const r = restored.getRun(original.run_id);
  assert.equal(r.status, 'completed'); assert.equal(r.metrics.model_calls, 3); assert.equal(r.metrics.provider_requests, 0);
  assert.equal(r.metrics.is_mock, true); assert.equal(next.calls.length, 1);
  assert.equal((await restored.decideApproval(r.run_id, a.approval_id, decision)).replayed, true);
  assert.equal(next.calls.length, 1); assert.equal((await h.store.listDrafts()).length, 1);
});

test('model change leaves completed historical runs untouched', async (t) => {
  const h = await setup(t, [{ text: final('Done'), usage }]); const original = await h.run('test');
  const savedBefore = (await h.store.loadRuns())[0];
  const restored = restartRunner(h, createScriptedModel([])); await restored.init();
  assert.deepEqual(restored.getRun(original.run_id), JSON.parse(JSON.stringify(original)));
  assert.deepEqual((await h.store.loadRuns())[0], savedBefore); assert.equal(h.bodies.length, 1);
});

test('unchanged HTTP identity resumes with a fresh adapter, keeping its budget across retry', async (t) => {
  const h = await setup(t, approvalReplies, { maxProviderRequests: 4 });
  const original = await h.run('save HTTP');
  const next = await provider(t, [{ status: 503 }, { text: final('Saved', ['http-status']), usage }]);
  const restored = restartRunner(h, next.model); await restored.init();
  assert.equal(restored.getRun(original.run_id).status, 'awaiting_approval');
  const a = original.approvals.at(-1);
  await restored.decideApproval(original.run_id, a.approval_id, { decision: 'approve', args_hash: a.args_hash }); await restored.idle(original.run_id);
  const r = restored.getRun(original.run_id);
  assert.equal(r.status, 'completed'); assert.equal(r.metrics.provider_requests, 4); assert.equal(r.metrics.retries, 1);
  assert.equal(r.metrics.limits.provider_requests, 4); assert.equal(r.metrics.model_calls, 3);
  assert.equal(r.metrics.tokens.reported.total, 45); assert.equal(r.metrics.tokens.status, 'mixed');
  assert.equal(h.bodies.length, 2); assert.equal(next.bodies.length, 2);
  assert.equal((await h.store.listDrafts()).length, 1);
});

test('a new HTTP run after model change uses the hard request gate even on retry', async (t) => {
  const h = await harness({ replies: approvalReplies.map((r) => r.text), limits: { maxProviderRequests: 1 } }); t.after(h.cleanup);
  const old = await h.run('save HTTP');
  const next = await provider(t, [{ status: 503 }, { text: final('Done'), usage }]);
  const restored = restartRunner(h, next.model); await restored.init();
  assert.equal(restored.getRun(old.run_id).failure.code, 'model_changed');
  const start = await restored.startRun('test'); await restored.idle(start.run_id);
  const r = restored.getRun(start.run_id);
  assert.equal(r.status, 'stopped'); assert.equal(r.failure.code, 'request_budget');
  assert.equal(r.metrics.is_mock, false); assert.equal(r.metrics.provider_requests, 1); assert.equal(r.metrics.retries, 0);
  assert.equal(next.bodies.length, 1); assert.equal((await h.store.listDrafts()).length, 0);
  assert.deepEqual(restored.getRun(old.run_id).metrics.tokens, old.metrics.tokens);
});
