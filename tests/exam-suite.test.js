import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEnvironment } from '../src/operations/context.js';
import { runSuite, selectCases, parseSuiteOptions } from '../src/operations/suite.js';
import { SMOKE_CASES, REHEARSAL_CASES } from '../src/operations/cases.js';
import { createServer } from 'node:http';
import { buildCatalog } from '../config/catalog.config.js';

async function fakeProvider(t, response) {
  const env = await loadEnvironment({ dotenv: false }); let requests = 0;
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    requests++; const body = JSON.parse(raw), reply = response(body);
    res.writeHead(reply.status ?? 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(reply.status ? { error: 'fake failure' } : { choices: [{ message: { content: JSON.stringify(reply.decision) } }], usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); });
  env.catalog = await buildCatalog({ tasks: [...env.catalog.tasks.values()].map((e) => e.task), profiles: [{ id: 'fake', label: 'Fake provider', config: {
    ...env.config.model, provider: 'openai-compatible', name: 'fake', baseUrl: `http://127.0.0.1:${server.address().port}/v1/`, apiKey: 'fixture-private-key' } }],
  defaultTaskId: 'study-notes', defaultProfileId: 'fake' });
  return { env, requests: () => requests };
}

test('repeat, case, profile and cloud request cap are validated before execution', async () => {
  for (const args of [['--repeat=0'], ['--repeat=6'], ['--repeat=NaN'], ['--only=unknown'], ['--live', '--cloud'], ['--max-requests=0'], ['--endpoint=http://evil']]) {
    assert.throws(() => parseSuiteOptions(args, SMOKE_CASES));
  }
  assert.equal(selectCases(SMOKE_CASES, 'sum').length, 1);
  assert.equal(parseSuiteOptions(['--live','--cloud','--max-requests=3'], SMOKE_CASES).maxRequests, 3);
});
test('both rehearsal tasks exercise the real runner with exact sources and blocked tools', async () => {
  const env = await loadEnvironment({ dotenv: false });
  const report = await runSuite({ env, cases: REHEARSAL_CASES, live: false, repeat: 1, profileId: 'mock' });
  assert.equal(report.status, 'PASS'); assert.equal(report.results.length, 8);
  for (const result of report.results) {
    assert.equal(result.status, 'PASS', result.id + ': ' + result.reason);
    assert.equal(result.metrics.provider_requests, 0);
    if (!result.id.endsWith('blocked')) assert.ok(result.final.source_ids[0].startsWith('ds-'));
  }
  assert.equal(report.model_evidence, 'SCRIPTED_BACKEND_ONLY');
});
test('offline notes smoke covers approval, replay, rejection and missing evidence', async () => {
  const env = await loadEnvironment({ dotenv: false });
  const result = await runSuite({ env, cases: SMOKE_CASES, live: false, repeat: 1, profileId: 'mock' });
  assert.equal(result.status, 'PASS'); assert.equal(result.results.length, 6);
  assert.equal(result.results.find((r) => r.id === 'approve').drafts, 1);
  assert.equal(result.results.find((r) => r.id === 'reject').drafts, 0);
});

for (const retry of [false, true]) test(`session cap blocks the next HTTP, including retry=${retry}`, async (t) => {
  const c = SMOKE_CASES.find((c) => c.id === 'sum');
  const h = await fakeProvider(t, () => retry ? { status: 503 } : { decision: { type: 'tool_call', tool: c.tool, arguments: c.args } });
  const r = await runSuite({ env: h.env, cases: [c], live: true, profileId: 'fake', repeat: 3, maxRequests: 1 });
  assert.equal(h.requests(), 1); assert.equal(r.session.provider_requests, 1);
  assert.deepEqual(r.results.map((r) => r.status), ['BLOCKED', 'NOT_RUN', 'NOT_RUN']);
  assert.equal(r.results[0].metrics.provider_requests, 1); assert.equal(r.results[0].metrics.retries, 0);
});
test('bounded repeats preserve all citation failures instead of selecting a good trial', async (t) => {
  const h = await fakeProvider(t, () => ({ decision: { type: 'final', answer: 'Invented', source_ids: ['fake-source'], unresolved: '' } }));
  const r = await runSuite({ env: h.env, cases: [SMOKE_CASES[1]], live: true, profileId: 'fake', repeat: 3, maxRequests: 12 });
  assert.deepEqual(r.results.map((r) => r.status), ['FAIL', 'FAIL', 'FAIL']); assert.equal(h.requests(), 9);
  assert.equal(r.demo_ready_cases.length, 0); assert.ok(r.results.every((r) => r.decisions.length === 3));
  assert.ok(!JSON.stringify(r).includes('fixture-private-key'));
});
test('smoke rejects totals assigned to the wrong groups even with correct numeric tokens', async (t) => {
  const c = SMOKE_CASES.find((c) => c.id === 'compare');
  const h = await fakeProvider(t, (body) => {
    const observation = body.messages.findLast((m) => m.content.startsWith('OBSERVATION'));
    if (!observation) return { decision: { type: 'tool_call', tool: c.tool, arguments: c.args } };
    const e = JSON.parse(observation.content.slice(observation.content.indexOf('{'))).untrusted_data.results[0];
    return { decision: { type: 'final', answer: 'Mon = 40; Tue = 55; Mon > Tue.', source_ids: [e.source_id], unresolved: '' } };
  });
  const r = await runSuite({ env: h.env, cases: [c], live: true, profileId: 'fake' });
  assert.equal(r.results[0].status, 'FAIL');
});
