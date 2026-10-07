import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { loadConfig } from '../config/agent.config.js';
import { buildCatalog } from '../config/catalog.config.js';
import { loadTaskConfig } from '../config/task.config.js';
import { createApp } from '../src/app.js';
import { createScriptedModel, createRuleBasedMock } from '../src/model/mock.js';
import { ROOT, TASK, tool, final } from './helpers.js';

export async function selectionFixture(t, { response, requestLimit = 12 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'agent-selection-test-'));
  const bodies = [];
  const provider = createServer(async (req, res) => {
    let text = ''; for await (const c of req) text += c;
    const body = JSON.parse(text); bodies.push(body);
    const reply = response ? await response(body, bodies.length) : { text: '{"ok":true}', usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } };
    if (reply.delay) await new Promise((r) => setTimeout(r, reply.delay));
    res.writeHead(reply.status ?? 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(reply.status ? { error: 'fake failure' } : { choices: [{ message: { content: reply.text } }], usage: reply.usage }));
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  const config = loadConfig(); config.limits.maxProviderRequests = requestLimit;
  const baseUrl = `http://127.0.0.1:${provider.address().port}/v1/`;
  const tables = await loadTaskConfig({ root: ROOT, file: join(ROOT, 'config/datasets-demo.task.json') });
  const makeCatalog = (over = {}) => buildCatalog({ tasks: [TASK, tables], profiles: [
    { id: 'env', label: 'Scripted notes', config: { ...config.model, provider: 'mock' }, model: createScriptedModel([tool('search_notes', { query: '401 403' }), tool('save_draft', { title: 'HTTP', content: '401 authentication', source_ids: ['http-status'] }), final('Saved', ['http-status'])]) },
    { id: 'http', label: 'Fake HTTP', config: { ...config.model, provider: 'openai-compatible', name: 'fake-http', baseUrl, apiKey: 'fake-test-secret', ...over }, requiresKey: false },
    { id: 'missing', label: 'Missing credential', config: { ...config.model, provider: 'openai-compatible', name: 'cloud', baseUrl, apiKey: '' }, requiresKey: true },
  ], defaultTaskId: TASK.id, defaultProfileId: 'env' });
  const catalog = await makeCatalog();
  const app = await createApp({ config, catalog, varDir: dir, publicDir: join(ROOT, 'public') });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const api = async (path, body) => {
    const response = await fetch(base + path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  t.after(async () => { for (const server of [app.server, provider]) { server.closeAllConnections(); await new Promise((r) => server.close(r)); } await rm(dir, { recursive: true, force: true }); });
  return { ...app, catalog, config, tables, bodies, api, dir, makeCatalog };
}

test('goal-only is backward compatible; metadata/selection never exposes secrets or paths', async (t) => {
  const h = await selectionFixture(t);
  const metadata = (await h.api('/api/catalog')).data;
  assert.equal(metadata.default_model_profile_id, 'env'); assert.equal(h.bodies.length, 0);
  const text = JSON.stringify(metadata);
  for (const forbidden of ['fake-test-secret', 'api_key_env', 'baseUrl', ROOT, h.dir, 'mission', 'arguments_schema']) assert.ok(!text.includes(forbidden), forbidden);
  const start = await h.api('/api/runs', { goal: 'save HTTP' }); assert.equal(start.status, 202);
  await h.runner.idle(start.data.run.run_id);
  const run = h.runner.getRun(start.data.run.run_id);
  assert.equal(run.status, 'awaiting_approval'); assert.equal(run.task_id, TASK.id); assert.equal(run.model_profile_id, 'env');
});

test('invalid IDs and browser overrides are refused before model/tool; missing key never falls back', async (t) => {
  const h = await selectionFixture(t);
  for (const payload of [{ task_id: '../task.json' }, { model_profile_id: 'unknown' }, { mission: 'override' }, { endpoint: 'http://evil' }, { allowed_tools: ['save_draft'] }]) {
    assert.equal((await h.api('/api/runs', { goal: 'test', ...payload })).status, 400);
  }
  const unavailable = await h.api('/api/runs', { goal: 'test', model_profile_id: 'missing' });
  assert.equal(unavailable.status, 409); assert.equal(unavailable.data.error, 'profile_unavailable');
  assert.equal(h.bodies.length, 0); assert.equal(h.runner.listRuns().length, 0);
});

test('different task/profile runtimes isolate tools, sources, budgets and active snapshots', async (t) => {
  const h = await selectionFixture(t, { response: (body) => {
    const observation = body.messages.findLast((m) => m.content.startsWith('OBSERVATION'));
    if (!observation) return { text: tool('query_dataset', { dataset_id: 'products', operation: 'count' }) };
    const evidence = JSON.parse(observation.content.slice(observation.content.indexOf('{'))).untrusted_data.results[0];
    return { text: final('4', [evidence.source_id]), usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } };
  } });
  const notes = await h.runner.startRun('save HTTP'); await h.runner.idle(notes.run_id);
  const tables = await h.runner.startRun('products count', { task_id: 'datasets-demo', model_profile_id: 'http' }); await h.runner.idle(tables.run_id);
  const done = h.runner.getRun(tables.run_id), pending = h.runner.getRun(notes.run_id);
  assert.equal(done.status, 'completed'); assert.equal(done.metrics.provider_requests, 2);
  assert.ok(done.final.source_ids[0].startsWith('ds-products-'));
  assert.deepEqual(done.configuration.task.tools.map((t) => t.name), ['query_dataset']);
  assert.equal(pending.status, 'awaiting_approval'); assert.equal(pending.metrics.provider_requests, 0);
  assert.deepEqual(pending.retrieved_source_ids, ['http-status']);
  assert.equal(done.configuration.task.data.datasets[0].row_count, 4);
});

test('restart resolves each saved configuration, not the currently selected default', async (t) => {
  const h = await selectionFixture(t);
  const start = await h.runner.startRun('save HTTP'); await h.runner.idle(start.run_id);
  const before = h.runner.getRun(start.run_id);
  const catalog = await h.makeCatalog(); catalog.defaultTaskId = 'datasets-demo'; catalog.defaultProfileId = 'http';
  const restored = await createApp({ config: h.config, catalog, varDir: h.dir, publicDir: join(ROOT, 'public') });
  const pending = restored.runner.getRun(start.run_id);
  assert.equal(pending.status, 'awaiting_approval'); assert.deepEqual(pending.metrics.tokens, before.metrics.tokens);
  const a = pending.approvals.at(-1);
  // New scripted instance starts at reply zero; replace complete only for this fixture's continuation.
  catalog.profiles.get('env').model.complete = async () => ({ text: final('Saved', ['http-status']) });
  await restored.runner.decideApproval(pending.run_id, a.approval_id, { decision: 'approve', args_hash: a.args_hash }); await restored.runner.idle(pending.run_id);
  assert.equal(restored.runner.getRun(pending.run_id).status, 'completed');
  assert.equal((await restored.store.listDrafts()).length, 1); assert.equal(h.bodies.length, 0);
});

for (const change of ['missing task', 'missing profile', 'task fingerprint', 'endpoint identity']) {
  test(`restart invalidates only the affected pending approval: ${change}`, async (t) => {
    const h = await selectionFixture(t, { response: (body) => {
      const hasObservation = body.messages.some((m) => m.content.startsWith('OBSERVATION'));
      return { text: hasObservation ? tool('save_draft', { title: 'HTTP', content: '401', source_ids: ['http-status'] }) : tool('search_notes', { query: '401 403' }) };
    } });
    const start = await h.runner.startRun('save HTTP', { model_profile_id: 'http' }); await h.runner.idle(start.run_id);
    const old = h.runner.getRun(start.run_id); assert.equal(old.status, 'awaiting_approval');
    const catalog = await h.makeCatalog(change === 'endpoint identity' ? { baseUrl: 'http://127.0.0.1:9999/v1/' } : {});
    if (change === 'missing task') catalog.tasks.delete(TASK.id);
    if (change === 'missing profile') catalog.profiles.delete('http');
    if (change === 'task fingerprint') catalog.tasks.get(TASK.id).task = { ...TASK, fingerprint: 'changed' };
    const restored = await createApp({ config: h.config, catalog, varDir: h.dir, publicDir: join(ROOT, 'public') });
    const r = restored.runner.getRun(start.run_id);
    assert.equal(r.status, 'failed'); assert.equal(r.pending_approval, null); assert.equal(r.approvals.at(-1).state, 'cancelled');
    assert.equal(r.failure.code, change.startsWith('missing') ? 'configuration_missing' : change.startsWith('task') ? 'task_changed' : 'model_changed');
    assert.deepEqual(r.metrics.tokens, old.metrics.tokens); assert.equal(r.metrics.provider_requests, 2);
    const a = old.approvals.at(-1);
    await assert.rejects(restored.runner.decideApproval(r.run_id, a.approval_id, { decision: 'approve', args_hash: a.args_hash }));
    assert.equal(h.bodies.length, 2); assert.equal((await h.store.listDrafts()).length, 0);
  });
}

for (const scenario of ['ok', 'missing usage', 'invalid protocol', 'missing content', '503', '429', 'timeout']) {
  test(`probe ${scenario}: one request maximum, separate accounting, no business context`, async (t) => {
    const h = await selectionFixture(t, { response: () => scenario === '503' || scenario === '429' ? { status: Number(scenario) }
      : scenario === 'timeout' ? { delay: 500, text: '{"ok":true}' }
        : { text: scenario === 'missing content' ? null : scenario === 'invalid protocol' ? '{"wrong":true}' : '{"ok":true}', usage: scenario === 'missing usage' ? null : { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } } });
    const probe = await h.api('/api/model-profiles/http/probe', { timeout_ms: 10 }); // frontend cannot control timeout
    assert.equal(probe.status, 400); assert.equal(h.bodies.length, 0);
    h.catalog.profiles.get('http').config.timeoutMs = 100;
    const result = await h.api('/api/model-profiles/http/probe', {});
    assert.equal(result.status, 200); assert.equal(result.data.probe.metrics.provider_requests, 1);
    assert.equal(h.bodies.length, 1); assert.equal(h.runner.listRuns().length, 0);
    assert.ok(h.bodies[0].max_tokens <= 64);
    assert.ok(!JSON.stringify(h.bodies[0]).includes('search_notes'));
    assert.equal(result.data.probe.protocol_ok, ['ok', 'missing usage'].includes(scenario));
    if (scenario === 'missing usage' || scenario === 'timeout' || ['503', '429'].includes(scenario)) assert.equal(result.data.probe.metrics.tokens.reported.total, null);
    if (scenario === 'timeout') assert.equal(result.data.probe.error.code, 'timeout');
    if (scenario === '503') assert.equal(result.data.probe.error.code, 'unavailable');
    if (scenario === '429') assert.equal(result.data.probe.error.code, 'rate_limited');
    if (scenario === 'missing content') { assert.equal(result.data.probe.endpoint_responded, true); assert.equal(result.data.probe.error.code, 'bad_response'); }
  });
}

test('offline mock supports the three configured dataset examples with backend evidence', async (t) => {
  const h = await selectionFixture(t);
  h.catalog.profiles.get('env').model = createRuleBasedMock();
  for (const [i, answer] of ['Total = 30.30', 'Count = 2', 'Mon = 55; Tue = 40; Mon > Tue'].entries()) {
    const start = await h.runner.startRun(h.tables.sampleInputs[i].goal, { task_id: h.tables.id });
    await h.runner.idle(start.run_id);
    const run = h.runner.getRun(start.run_id);
    assert.equal(run.status, 'completed'); assert.equal(run.final.answer, answer);
    assert.ok(run.final.source_ids[0].startsWith('ds-')); assert.equal(run.metrics.provider_requests, 0);
    assert.equal(run.metrics.repairs, 0); assert.equal(run.steps_used, 1);
  }
  const unsupported = await h.runner.startRun('Find a completely different dataset', { task_id: h.tables.id });
  await h.runner.idle(unsupported.run_id);
  const run = h.runner.getRun(unsupported.run_id);
  assert.equal(run.status, 'completed'); assert.equal(run.steps_used, 0);
  assert.deepEqual(run.final.source_ids, []); assert.match(run.final.unresolved, /mock/i);
  assert.equal(h.bodies.length, 0);
});

test('changing selections and limits only affects new runs, including after restart', async (t) => {
  const h = await selectionFixture(t);
  const old = await h.runner.startRun('save HTTP'); await h.runner.idle(old.run_id);
  h.config.limits.maxProviderRequests = 1; h.config.limits.maxSteps = 2;
  h.catalog.defaultProfileId = 'http'; h.catalog.defaultTaskId = h.tables.id;
  const newer = await h.runner.startRun('table demo'); await h.runner.idle(newer.run_id);
  const pending = h.runner.getRun(old.run_id);
  assert.equal(pending.model_profile_id, 'env'); assert.equal(pending.task_id, TASK.id);
  assert.equal(pending.metrics.limits.provider_requests, 12); assert.equal(pending.configuration.limits.max_steps, 6);
  assert.equal(h.runner.getRun(newer.run_id).metrics.limits.provider_requests, 1);
  const restored = await createApp({ config: h.config, catalog: await h.makeCatalog(), varDir: h.dir, publicDir: join(ROOT, 'public') });
  assert.equal(restored.runner.getRun(old.run_id).metrics.limits.provider_requests, 12);
  assert.equal(restored.runner.getRun(old.run_id).configuration.limits.max_steps, 6);
  assert.equal(restored.runner.getRun(old.run_id).status, 'awaiting_approval');
});

test('missing profile cancels only its pending run; completed history and replay survive restart', async (t) => {
  const next = (messages) => messages.some((m) => m.content.startsWith('OBSERVATION'))
    ? tool('save_draft', { title: 'HTTP', content: '401', source_ids: ['http-status'] }) : tool('search_notes', { query: '401 403' });
  const h = await selectionFixture(t, { response: (body) => ({ text: next(body.messages) }) });
  const pending = await h.runner.startRun('save HTTP'); await h.runner.idle(pending.run_id);
  const old = h.runner.getRun(pending.run_id), a = old.approvals.at(-1);
  await h.runner.decideApproval(old.run_id, a.approval_id, { decision: 'approve', args_hash: a.args_hash }); await h.runner.idle(old.run_id);
  const complete = h.runner.getRun(old.run_id); assert.equal(complete.status, 'completed');
  const file = join(h.dir, 'runs', `${old.run_id}.json`), before = await readFile(file, 'utf8');
  h.catalog.profiles.get('env').model.complete = async ({ messages }) => ({ text: next(messages) });
  const unaffected = await h.runner.startRun('save HTTP'); await h.runner.idle(unaffected.run_id);
  const affected = await h.runner.startRun('save HTTP', { model_profile_id: 'http' }); await h.runner.idle(affected.run_id);
  assert.equal(h.runner.getRun(affected.run_id).status, 'awaiting_approval');
  const catalog = await h.makeCatalog(); catalog.profiles.delete('http');
  const restored = await createApp({ config: h.config, catalog, varDir: h.dir, publicDir: join(ROOT, 'public') });
  assert.equal(restored.runner.getRun(affected.run_id).failure.code, 'configuration_missing');
  assert.equal(restored.runner.getRun(unaffected.run_id).status, 'awaiting_approval');
  assert.equal(await readFile(file, 'utf8'), before, 'terminal snapshot is never rewritten');
  const replay = await restored.runner.decideApproval(old.run_id, a.approval_id, { decision: 'approve', args_hash: a.args_hash });
  assert.equal(replay.replayed, true); assert.deepEqual(replay.run.metrics, complete.metrics);
  assert.equal((await restored.store.listDrafts()).length, 1); assert.equal(h.bodies.length, 2);
  for (let i = 0; i < 3; i++) assert.equal((await h.api(`/api/runs/${old.run_id}`)).status, 200);
  assert.equal((await h.store.listDrafts()).length, 1); assert.equal(h.bodies.length, 2);
});

test('unavailable and mock probes are explicit and separately audited, never live HTTP', async (t) => {
  const h = await selectionFixture(t);
  const missing = (await h.api('/api/model-profiles/missing/probe', {})).data.probe;
  const mock = (await h.api('/api/model-profiles/env/probe', {})).data.probe;
  assert.equal(missing.error.code, 'profile_unavailable'); assert.equal(missing.metrics.model_calls, 0);
  assert.equal(mock.is_mock, true); assert.equal(mock.endpoint_responded, false); assert.equal(mock.protocol_ok, true);
  assert.equal(mock.metrics.model_calls, 1); assert.equal(mock.metrics.provider_requests, 0);
  assert.equal(mock.metrics.tokens.reported.total, null); assert.equal(h.bodies.length, 0);
  assert.equal(h.runner.listRuns().length, 0);
  const audit = await readFile(join(h.dir, 'logs/audit.jsonl'), 'utf8');
  assert.equal(audit.trim().split('\n').length, 2); assert.ok(!audit.includes('fake-test-secret'));
});

test('legacy runs without selection or metrics remain readable and cannot resume unbudgeted writes', async (t) => {
  const h = await selectionFixture(t);
  const start = await h.runner.startRun('save HTTP'); await h.runner.idle(start.run_id);
  const raw = (await h.store.loadRuns()).find((r) => r.run_id === start.run_id);
  for (const key of ['task_id', 'model_profile_id', 'model_identity', 'configuration', 'runtime_settings', 'metrics']) delete raw[key];
  await h.store.saveRun(raw);
  const restored = await createApp({ config: h.config, catalog: await h.makeCatalog(), varDir: h.dir, publicDir: join(ROOT, 'public') });
  const run = restored.runner.getRun(start.run_id), a = run.approvals.at(-1);
  assert.equal(run.status, 'awaiting_approval'); assert.equal(run.metrics.collection, 'not_collected');
  assert.equal(run.metrics.tokens.reported.total, null);
  await restored.runner.decideApproval(run.run_id, a.approval_id, { decision: 'approve', args_hash: a.args_hash });
  assert.equal(restored.runner.getRun(run.run_id).status, 'stopped');
  assert.equal(restored.runner.getRun(run.run_id).failure.code, 'metrics_unavailable');
  assert.equal((await h.store.listDrafts()).length, 0); assert.equal(h.bodies.length, 0);
});

test('missing configuration finalizes waiting time without resetting historical accounting', async (t) => {
  const h = await selectionFixture(t);
  const start = await h.runner.startRun('save HTTP'); await h.runner.idle(start.run_id);
  const raw = (await h.store.loadRuns()).find((r) => r.run_id === start.run_id);
  raw.created_at = new Date(Date.now() - 2000).toISOString(); raw.metrics.approval_wait_started_at = Date.now() - 1000;
  await h.store.saveRun(raw);
  const catalog = await h.makeCatalog(); catalog.profiles.delete('env');
  const restored = await createApp({ config: h.config, catalog, varDir: h.dir, publicDir: join(ROOT, 'public') });
  const run = restored.runner.getRun(start.run_id);
  assert.equal(run.failure.code, 'configuration_missing');
  assert.ok(run.metrics.approval_wait_ms >= 1000); assert.ok(run.metrics.wall_ms >= 2000);
  assert.deepEqual(run.metrics.tokens, raw.metrics.tokens); assert.equal(run.metrics.model_calls, raw.metrics.model_calls);
  assert.equal(run.metrics.approval_wait_started_at, null); assert.equal(h.bodies.length, 0);
});
