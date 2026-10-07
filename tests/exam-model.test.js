import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { inspectLocalModel, warmProfile } from '../src/operations/localModel.js';
import { createOpenAICompatibleModel } from '../src/model/openaiCompatible.js';
import { harness } from './helpers.js';

async function fixture(t, reply = {}) {
  let requests = 0; const reads = [];
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET') { reads.push(req.url); return res.end(JSON.stringify({ models: req.url === '/api/tags' ? [{ name: 'qwen3:8b' }] : [] })); }
    requests++; let raw = ''; for await (const c of req) raw += c;
    if (!reply.runner) assert.ok(!raw.includes('search_notes'));
    assert.ok(JSON.parse(raw).max_tokens <= 64);
    if (reply.redirect && req.url !== '/redirected') { res.writeHead(307, { location: '/redirected' }); res.end(); return; }
    if (reply.delay) await new Promise((r) => setTimeout(r, reply.delay));
    res.writeHead(reply.status ?? 200);
    res.end(JSON.stringify(reply.status ? { error: 'simulated' } : { choices: [{ message: { content: '{"ok":true}' } }], usage: reply.usage }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); });
  const profile = { id: 'local', model: {}, config: { baseUrl: `http://127.0.0.1:${server.address().port}/v1/`, provider: 'openai-compatible', name: 'qwen3:8b', maxOutputTokens: 800, timeoutMs: 30000, jsonMode: true }, metadata: { is_mock: false, name: 'qwen3:8b' } };
  return { profile, requests: () => requests, reads };
}
test('local inspection only reads installed/loaded model metadata', async (t) => {
  const h = await fixture(t); const status = await inspectLocalModel(h.profile);
  assert.equal(status.installed, true); assert.equal(status.loaded, false);
  assert.equal(h.requests(), 0); assert.deepEqual(h.reads, ['/api/tags', '/api/ps']);
  const missing = await inspectLocalModel({ ...h.profile, config: { ...h.profile.config, name: 'not-installed' } });
  assert.equal(missing.installed, false); assert.match(missing.suggestion, /not-installed/);
});
for (const scenario of ['success', '503', '429', 'timeout', 'no usage']) test(`warm ${scenario} sends at most one model HTTP with its own usage`, async (t) => {
  const h = await fixture(t, ['503', '429'].includes(scenario) ? { status: Number(scenario) } : scenario === 'timeout' ? { delay: 200 }
    : scenario === 'success' ? { usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 } } : {});
  const warm = await warmProfile(h.profile, { timeoutMs: scenario === 'timeout' ? 50 : 2000 });
  assert.equal(h.requests(), 1); assert.equal(warm.metrics.provider_requests, 1); assert.equal(warm.metrics.retries, 0);
  if (scenario === 'success') assert.equal(warm.metrics.tokens.reported.total, 10);
  else assert.equal(warm.metrics.tokens.reported.total, null);
  if (scenario === 'timeout') assert.equal(warm.error.code, 'timeout');
  if (scenario === '503') assert.equal(warm.error.code, 'unavailable');
  if (scenario === '429') assert.equal(warm.error.code, 'rate_limited');
});
test('warm refuses cloud, mock, unavailable and invalid timeout before HTTP', async (t) => {
  const h = await fixture(t);
  for (const profile of [{ ...h.profile, config: { ...h.profile.config, baseUrl: 'https://example.com/v1/' } },
    { ...h.profile, metadata: { is_mock: true } }, { ...h.profile, model: null }]) {
    await assert.rejects(warmProfile(profile));
  }
  await assert.rejects(warmProfile(h.profile, { timeoutMs: Infinity })); assert.equal(h.requests(), 0);
});

test('warm does not follow an HTTP redirect into a second unaccounted request', async (t) => {
  const h = await fixture(t, { redirect: true }); const warm = await warmProfile(h.profile);
  assert.equal(h.requests(), 1); assert.equal(warm.metrics.provider_requests, 1); assert.equal(warm.metrics.retries, 0);
  assert.equal(warm.error.code, 'bad_request');
});

test('runner request budget cannot be bypassed by an HTTP redirect; no tools or writes execute', async (t) => {
  const p = await fixture(t, { redirect: true, runner: true });
  const h = await harness({ model: createOpenAICompatibleModel({ ...p.profile.config, maxOutputTokens: 64 }), limits: { maxProviderRequests: 1 } });
  t.after(h.cleanup); const run = await h.run('Explain HTTP 401.');
  assert.equal(p.requests(), 1); assert.equal(run.metrics.provider_requests, 1); assert.equal(run.metrics.retries, 0);
  assert.equal(run.status, 'failed'); assert.equal(run.failure.code, 'model_request_rejected');
  assert.equal(run.steps_used, 0); assert.equal((await h.store.listDrafts()).length, 0);
  assert.equal(run.metrics.tokens.reported.total, null); assert.ok(run.metrics.tokens.estimated.total > 0);
});
