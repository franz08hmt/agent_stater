import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConfigurationDemo } from '../scripts/configurationDemoFixture.js';
import { createApp } from '../src/app.js';
import { ROOT } from './helpers.js';
import { join } from 'node:path';

async function fixture(t) {
  const f = await createConfigurationDemo(); t.after(f.close); f.controls.delayMs = 0;
  const r = await f.runner.startRun('HTTP 429', { model_profile_id: 'http' }); await f.runner.idle(r.run_id);
  const run = f.runner.getRun(r.run_id); assert.equal(run.status, 'completed');
  return { ...f, run };
}
const post = (f, body) => fetch(`${f.url}/api/runs/${f.run.run_id}/followups`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('HTTP follow-up validates before model, no retry on 503/429, missing usage not zero, hard session cap', async (t) => {
  const f = await fixture(t), original = f.runner.getRun(f.run.run_id), count = f.requests.length;
  assert.equal((await post(f, { request: 'Save a draft.' })).status, 400);
  assert.equal((await post(f, { request: 'Translate the previous answer into English.', endpoint: 'arbitrary' })).status, 400);
  assert.equal(f.requests.length, count);
  for (const mode of ['503', '429', 'missing usage']) {
    f.controls.run = mode;
    const res = await post(f, { request: 'Translate the previous answer into English.' });
    assert.equal(res.status, 200);
    const { followup } = await res.json(); assert.equal(followup.status, 'FAIL');
    assert.equal(followup.metrics.retries, 0);
  }
  assert.equal(f.requests.length, count + 3);
  const ledger = (await (await fetch(`${f.url}/api/runs/${f.run.run_id}/followups`)).json()).followups;
  assert.equal(ledger.metrics.provider_requests, 3); assert.equal(ledger.metrics.tokens.reported.total, null);
  assert.equal(ledger.metrics.tokens.unavailable_requests, 3); assert.ok(ledger.metrics.tokens.estimated.total > 0);
  assert.equal((await post(f, { request: 'Giải thích lại bằng tiếng Việt.' })).status, 409);
  assert.equal(f.requests.length, count + 3);
  assert.deepEqual(f.runner.getRun(f.run.run_id), original);
});

test('in-flight follow-up reload is GET only, duplicate is blocked; restart preserves unresolved reservation without inference', async (t) => {
  const f = await fixture(t), count = f.requests.length;
  let release; f.controls.requestGate = new Promise((r) => { release = r; });
  t.after(() => release());
  let recorded;
  const accountingSaved = new Promise((r) => { recorded = r; });
  const save = f.store.saveFollowups;
  f.store.saveFollowups = async (ledger) => { await save(ledger); if (ledger.metrics.tokens.pending_requests === 1) recorded(); };
  const pending = post(f, { request: 'Giải thích lại bằng tiếng Việt.' });
  await accountingSaved;
  const ledger = await f.store.getFollowups(f.run.run_id);
  assert.equal(ledger.metrics.tokens.pending_requests, 1);
  const snapshot = structuredClone(ledger);
  assert.equal((await post(f, { request: 'Translate the previous answer into English.' })).status, 409);
  assert.equal((await fetch(`${f.url}/api/runs/${f.run.run_id}/followups`)).status, 200);
  assert.equal(f.requests.length, count + 1);
  release(); await pending;
  // Restore only the captured in-flight fixture ledger; production never replays inference.
  await f.store.saveFollowups(snapshot);
  const restarted = await createApp({ config: f.config, catalog: f.catalog, varDir: f.store.root, publicDir: join(ROOT, 'public') });
  assert.equal((await f.store.getFollowups(f.run.run_id)).results[0].status, 'BLOCKED');
  assert.equal((await f.store.getFollowups(f.run.run_id)).metrics.tokens.unavailable_requests, 1);
  assert.equal((await f.store.getFollowups(f.run.run_id)).metrics.tokens.estimated.total, snapshot.metrics.tokens.estimated.total);
  assert.equal(f.requests.length, count + 1);
  assert.deepEqual(restarted.runner.getRun(f.run.run_id).final, f.run.final);
});

test('follow-up timeout is one charged HTTP; invalid answer-language option remains forbidden', async (t) => {
  const f = await fixture(t); f.controls.run = 'timeout';
  f.catalog.profiles.get('http').config.timeoutMs = 30;
  const count = f.requests.length, res = await post(f, { request: 'Translate the previous answer into English.' });
  const { followup } = await res.json(); assert.equal(followup.error.code, 'timeout');
  assert.equal(followup.metrics.provider_requests, 1); assert.equal(followup.metrics.tokens.unavailable_requests, 1);
  assert.equal(f.requests.length, count + 1);
  for (const answer_language of ['vi', 'en', null, 12]) {
    assert.equal((await fetch(`${f.url}/api/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: 'HTTP 429', answer_language }) })).status, 400);
  }
  assert.equal(f.requests.length, count + 1);
});
