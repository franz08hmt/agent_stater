// HTTP boundary: request validation, status codes and the approval flow end to end,
// using the rule-based mock so it runs offline.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { createRuleBasedMock } from '../src/model/mock.js';
import { ROOT, NOTES_DIR, LIMITS } from './helpers.js';

const SECRET = 'sk-test-must-never-appear-in-responses';
let base, server, dir;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-api-'));
  const config = {
    model: { provider: 'mock', name: 'rule-based-mock', apiKey: SECRET, timeoutMs: 2000 },
    limits: LIMITS,
    server: { maxBodyBytes: 16 * 1024 },
  };
  ({ server } = await createApp({ config, model: createRuleBasedMock(), dataDir: NOTES_DIR, varDir: dir, publicDir: join(ROOT, 'public') }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true, force: true });
});

const post = (path, body, headers = { 'content-type': 'application/json' }) =>
  fetch(base + path, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

async function waitUntilSettled(runId) {
  for (let i = 0; i < 100; i++) {
    const { run } = await (await fetch(`${base}/api/runs/${runId}`)).json();
    if (run.status !== 'running') return run;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('run did not settle');
}

test('health reports the model mode and never the key', async () => {
  const res = await fetch(`${base}/api/health`);
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(text).model.is_mock, true);
  assert.ok(!text.includes(SECRET));
});

test('request validation: empty goal 400, oversized goal 400, bad JSON 400, wrong type 415, huge body 413', async () => {
  assert.equal((await post('/api/runs', { goal: '' })).status, 400);
  assert.equal((await post('/api/runs', { goal: 'x'.repeat(501) })).status, 400);
  assert.equal((await post('/api/runs', '{not json')).status, 400);
  assert.equal((await post('/api/runs', { goal: 'hi' }, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await post('/api/runs', { goal: 'x'.repeat(20000) })).status, 413);
  assert.equal((await fetch(`${base}/api/runs/run_nope`)).status, 404);
});

test('full flow over HTTP: start -> awaiting approval -> approve -> completed, one draft, replay safe', async () => {
  const start = await post('/api/runs', { goal: 'Tóm tắt về idempotency và lưu bản nháp' });
  assert.equal(start.status, 202);
  const { run } = await start.json();
  const waiting = await waitUntilSettled(run.run_id);
  assert.equal(waiting.status, 'awaiting_approval');
  const a = waiting.approvals.find((x) => x.approval_id === waiting.pending_approval);

  const wrong = await post(`/api/runs/${run.run_id}/approvals/${a.approval_id}`, { decision: 'approve', args_hash: 'deadbeef' });
  assert.equal(wrong.status, 409);

  const ok = await post(`/api/runs/${run.run_id}/approvals/${a.approval_id}`, { decision: 'approve', args_hash: a.args_hash });
  assert.equal(ok.status, 200);
  const again = await post(`/api/runs/${run.run_id}/approvals/${a.approval_id}`, { decision: 'approve', args_hash: a.args_hash });
  assert.equal((await again.json()).replayed, true);

  const done = await waitUntilSettled(run.run_id);
  assert.equal(done.status, 'completed');
  assert.ok(done.final.source_ids.includes('idempotency'));
  const { drafts } = await (await fetch(`${base}/api/drafts`)).json();
  assert.equal(drafts.filter((d) => d.run_id === run.run_id).length, 1);
  assert.ok(!JSON.stringify(done).includes(SECRET));
});

test('static UI is served with a content security policy', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(await res.text(), /Agent Studio — Configure, run and inspect an AI agent/);
});
