// The real-provider adapter, exercised against a local HTTP server (no internet, no key).
// These prove how the adapter handles quota and outage responses — the parts that decide
// whether a rate limit silently burns more of a daily quota.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createOpenAICompatibleModel } from '../src/model/openaiCompatible.js';
import { harness } from './helpers.js';

/** Start a local provider. `respond(n, req)` returns [status, body] for the n-th request (1-based). */
async function provider(respond) {
  const hits = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    hits.push({ url: req.url, headers: req.headers, body });
    const [status, payload] = respond(hits.length, req);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { hits, baseUrl: `http://127.0.0.1:${server.address().port}/v1/`, close: () => new Promise((r) => server.close(r)) };
}

const ok = (text) => [200, { choices: [{ message: { content: text } }], usage: { total_tokens: 7 } }];
const cfg = (baseUrl, over = {}) => ({ baseUrl, name: 'test-model', apiKey: '', jsonMode: true, reasoningEffort: '', temperature: 0, maxOutputTokens: 100, ...over });
const ask = (model) => model.complete({ messages: [{ role: 'user', content: 'hi' }], signal: AbortSignal.timeout(3000) });

test('request shape: path, model, JSON mode, reasoning effort and bearer key are sent as configured', async (t) => {
  const p = await provider(() => ok('{"ok":true}'));
  t.after(p.close);
  const model = createOpenAICompatibleModel(cfg(p.baseUrl, { apiKey: 'sk-test-abcdef123456', reasoningEffort: 'none' }));
  assert.equal((await ask(model)).text, '{"ok":true}');
  const [hit] = p.hits;
  assert.equal(hit.url, '/v1/chat/completions');
  assert.equal(hit.headers.authorization, 'Bearer sk-test-abcdef123456');
  assert.equal(hit.body.model, 'test-model');
  assert.deepEqual(hit.body.response_format, { type: 'json_object' });
  assert.equal(hit.body.reasoning_effort, 'none');
  assert.equal(hit.body.max_tokens, 100);
});

test('request shape: without a key there is no Authorization header, and JSON mode / reasoning can be switched off', async (t) => {
  const p = await provider(() => ok('{}'));
  t.after(p.close);
  await ask(createOpenAICompatibleModel(cfg(p.baseUrl, { jsonMode: false })));
  assert.equal(p.hits[0].headers.authorization, undefined);
  assert.equal('response_format' in p.hits[0].body, false);
  assert.equal('reasoning_effort' in p.hits[0].body, false);
});

test('HTTP 429 is classified rate_limited and is NOT retried: exactly one request is sent', async (t) => {
  const p = await provider(() => [429, { error: { code: 429, message: 'You exceeded your current quota', status: 'RESOURCE_EXHAUSTED' } }]);
  t.after(p.close);
  await assert.rejects(ask(createOpenAICompatibleModel(cfg(p.baseUrl))), (err) => {
    assert.equal(err.kind, 'rate_limited');
    assert.equal(err.status, 429);
    assert.match(err.message, /HTTP 429/);
    return true;
  });
  assert.equal(p.hits.length, 1, 'a retried 429 would spend more quota for nothing');
});

test('a 429 surfaces which quota was hit and the retry delay, so "wait a minute" and "wait until tomorrow" can be told apart', async (t) => {
  const body = { error: { code: 429, message: 'quota', details: [
    { violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '20' }] },
    { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '52s' },
  ] } };
  const p = await provider(() => [429, body]);
  t.after(p.close);
  await assert.rejects(ask(createOpenAICompatibleModel(cfg(p.baseUrl))), (err) => {
    assert.match(err.message, /HTTP 429 \[quotaId=GenerateRequestsPerDayPerProjectPerModel-FreeTier, retryDelay=52s\]/);
    return true;
  });
  const bare = await provider(() => [429, 'Too Many Requests']);
  t.after(bare.close);
  await assert.rejects(ask(createOpenAICompatibleModel(cfg(bare.baseUrl))), (err) => {
    assert.match(err.message, /^Model endpoint returned HTTP 429: Too Many Requests$/, 'no invented details when the provider gives none');
    return true;
  });
});

test('HTTP 503 is retried exactly once, then reported as unavailable', async (t) => {
  const p = await provider(() => [503, { error: 'overloaded' }]);
  t.after(p.close);
  await assert.rejects(ask(createOpenAICompatibleModel(cfg(p.baseUrl))), { kind: 'unavailable' });
  assert.equal(p.hits.length, 2, 'one original attempt + one retry');
});

test('a transient 503 followed by success recovers without failing the run', async (t) => {
  const p = await provider((n) => (n === 1 ? [503, 'busy'] : ok('{"type":"final"}')));
  t.after(p.close);
  assert.equal((await ask(createOpenAICompatibleModel(cfg(p.baseUrl)))).text, '{"type":"final"}');
  assert.equal(p.hits.length, 2);
});

test('other 4xx (bad key, bad request) are not retried', async (t) => {
  for (const status of [400, 401, 403, 404]) {
    const p = await provider(() => [status, { error: 'nope' }]);
    await assert.rejects(ask(createOpenAICompatibleModel(cfg(p.baseUrl))), { kind: 'bad_request' });
    assert.equal(p.hits.length, 1, `HTTP ${status} was retried`);
    await p.close();
  }
});

test('an API key repeated in a provider error body is masked before it can reach a log', async (t) => {
  const key = 'sk-secret-should-never-be-logged';
  const p = await provider(() => [401, { error: `Invalid credential ${key} for this project` }]);
  t.after(p.close);
  await assert.rejects(ask(createOpenAICompatibleModel(cfg(p.baseUrl, { apiKey: key }))), (err) => {
    assert.ok(!err.message.includes(key), err.message);
    assert.match(err.message, /\[redacted\]/);
    return true;
  });
});

test('through the runner: a 429 ends the run as failed/model_rate_limited after a single request', async (t) => {
  const p = await provider(() => [429, { error: { message: 'quota exceeded' } }]);
  t.after(p.close);
  const h = await harness({ model: createOpenAICompatibleModel(cfg(p.baseUrl)) });
  t.after(h.cleanup);
  const run = await h.run('Câu hỏi bất kỳ');
  assert.equal(run.status, 'failed');
  assert.equal(run.failure.code, 'model_rate_limited');
  assert.match(run.failure.message, /HTTP 429/);
  assert.equal(p.hits.length, 1);
});

test('the runner records which passages a tool returned, not only which documents', async (t) => {
  const h = await harness({ replies: [
    JSON.stringify({ type: 'tool_call', tool: 'search_notes', arguments: { query: 'mẹo ôn tập diễn đàn', limit: 3 } }),
    JSON.stringify({ type: 'final', answer: 'x', source_ids: [], unresolved: 'y' }),
  ] });
  t.after(h.cleanup);
  const run = await h.run('Tổng hợp mẹo ôn tập từ ghi chú chép diễn đàn');
  assert.ok(run.retrieved_passages.includes('forum-copy§1'));
  assert.ok(run.retrieved_passages.includes('forum-copy§2'), 'the poisoned paragraph is individually recorded');
  assert.deepEqual(run.retrieved_source_ids.filter((id) => id === 'forum-copy'), ['forum-copy']);
});
