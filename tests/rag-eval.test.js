import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockHarness, readManifest } from '../eval/sunrise-mock.js';
import { runAcceptanceCampaign, MAX_SESSION_CAP } from '../src/rag/evalRunner.js';
import { ModelError } from '../src/model/openaiCompatible.js';

const { manifest, reference } = await readManifest();
const SUNRISE = manifest.task_id;

/** A scripted "model" object with the same shape the catalog expects. */
const scripted = (replies) => {
  const model = { provider: 'mock', name: 'scripted-mock', isMock: true, calls: [], async complete() {
    const reply = replies(model.calls.length + 1);
    model.calls.push(reply);
    if (reply instanceof Error) throw reply;
    return { text: typeof reply === 'string' ? reply : JSON.stringify(reply), usage: null };
  } };
  return model;
};
const search = (query) => ({ type: 'tool_call', tool: 'search_kb', arguments: { query } });

async function campaign(t, { ollama, caps = { generation: 24, embedding: 24 }, capLimit, only, mutate, prepare } = {}) {
  const refs = structuredClone(reference);
  mutate?.(refs);
  const harness = await createMockHarness({ reference: refs, ollama });
  t.after(harness.close);
  const testCases = only ? manifest.cases.filter((c) => only.includes(c.id)) : manifest.cases;
  const out = await runAcceptanceCampaign({ catalog: harness.catalog, config: harness.config, store: harness.store, testCases, taskId: SUNRISE, profileId: harness.mockProfileId,
    caps, capLimit, prepare: (c) => { harness.prepare(c); prepare?.(c, harness); } });
  return { ...out, harness };
}

test('mock harness: every case runs end to end through the real runner and the grader passes the reference answers', async (t) => {
  const { results, summary, session, harness } = await campaign(t, { caps: { generation: 100, embedding: 100 }, capLimit: 100 });
  assert.equal(results.length, manifest.cases.length);
  for (const r of results) assert.equal(r.status, 'PASS', `${r.id}: ${r.reasons.join(' | ')}`);
  assert.deepEqual([summary.status, summary.exit_code, summary.complete], ['PASS', 0, true]);
  // accounting: one index batch + one query embedding per case; the mock model sends no HTTP
  assert.equal(harness.embedRequests(), harness.indexRequests + manifest.cases.length);
  assert.equal(session.used.embedding, manifest.cases.length);
  assert.equal(session.used.generation, 0);
  for (const r of results) {
    assert.equal(r.embeddings.requests, 1);
    assert.equal(r.generation.is_mock, true);
    assert.ok(r.run_id && r.retrieved[0].chunks.some((c) => c.match.includes('required')), `${r.id}: required context shown`);
  }
});

test('mock harness: a wrong scripted answer FAILS that case and the whole set; others keep their own verdict', async (t) => {
  const { results, summary } = await campaign(t, { only: ['S01', 'S05', 'S18'], mutate: (refs) => { refs.S01.answer = 'The current dermatology consultation fee is 450,000 VND.'; } });
  assert.deepEqual(results.map((r) => [r.id, r.status]), [['S01', 'FAIL'], ['S05', 'PASS'], ['S18', 'PASS']]);
  assert.deepEqual([summary.status, summary.exit_code], ['FAIL', 1]);
  assert.match(results[0].reasons.join(' '), /450,000|dermatolog/i);
});

test('a citation of a chunk that was never shown is refused by the backend; the run does not become a PASS', async (t) => {
  const { results } = await campaign(t, { only: ['S05'], prepare: (c, h) => {
    h.catalog.profiles.get('mock').model = scripted((n) => (n === 1 ? search('Sunday opening hours')
      : { type: 'final', answer: 'Only Thu Duc is open on Sunday from 8:00 to 12:00 and the District 1 branch is closed.', source_ids: ['kb-b-s99-c1'], unresolved: '' }));
  } });
  assert.notEqual(results[0].status, 'PASS');
  assert.ok(['FAIL', 'REVIEW_REQUIRED'].includes(results[0].status));
});

test('session cap: a small embedding cap leaves the remaining cases NOT_RUN and never sends one request more', async (t) => {
  const { results, summary, session, harness } = await campaign(t, { caps: { generation: 24, embedding: 3 } });
  assert.deepEqual(results.slice(0, 3).map((r) => r.status), ['PASS', 'PASS', 'PASS']);
  assert.ok(results.slice(3).every((r) => r.status === 'NOT_RUN' && /embedding request cap reached/.test(r.reasons[0])));
  assert.equal(session.used.embedding, 3);
  assert.equal(harness.embedRequests(), harness.indexRequests + 3, 'exactly the capped number of query embeddings reached the endpoint');
  assert.deepEqual([summary.status, summary.complete, summary.exit_code], ['REVIEW_REQUIRED', false, 4], 'an incomplete session is never a clean PASS');
});

test('session cap: the per-run limit is clamped to what is left, even for a model that keeps searching', async (t) => {
  const { results, harness } = await campaign(t, { only: ['S01'], caps: { generation: 24, embedding: 1 }, prepare: (c, h) => {
    h.catalog.profiles.get('mock').model = scripted((n) => search(`dermatology fee attempt ${n}`));
  } });
  assert.equal(harness.embedRequests(), harness.indexRequests + 1, 'the second search was refused before any HTTP');
  assert.equal(results[0].embeddings.requests, 1);
  assert.notEqual(results[0].status, 'PASS');
});

test('a provider failure stops the session: BLOCKED, then NOT_RUN, no further embedding or model requests', async (t) => {
  const { results, summary, harness } = await campaign(t, { only: ['S01', 'S02', 'S03'], prepare: (c, h) => {
    h.catalog.profiles.get('mock').model = scripted(() => new ModelError('rate_limited', 'HTTP 429'));
  } });
  assert.deepEqual(results.map((r) => r.status), ['BLOCKED', 'NOT_RUN', 'NOT_RUN']);
  assert.match(results[1].reasons[0], /session stopped: model_rate_limited/);
  assert.equal(summary.status, 'BLOCKED');
  assert.equal(summary.exit_code, 3);
  assert.equal(harness.embedRequests(), harness.indexRequests, 'no query embedding was sent');
});

test('an embedding-service failure during a run is BLOCKED (not a model failure) and stops the session', async (t) => {
  const { results, summary, session } = await campaign(t, { only: ['S01', 'S02'], ollama: { fail: (n) => (n >= 2 ? { status: 503 } : null) } });
  assert.equal(results[0].status, 'BLOCKED');
  assert.match(results[0].reasons[0], /embedding service failed/);
  assert.equal(results[1].status, 'NOT_RUN');
  assert.equal(summary.exit_code, 3);
  assert.equal(session.used.embedding, 1, 'one failed request counted, no retry');
});

test('a live-style session of 24 query embeddings cannot cover all cases: the rest is NOT_RUN, not silently skipped', async (t) => {
  const { results, summary, session } = await campaign(t, { caps: { generation: 24, embedding: 24 } });
  assert.equal(results.filter((r) => r.status === 'NOT_RUN').length, manifest.cases.length - 24);
  assert.equal(session.used.embedding, 24);
  assert.equal(summary.complete, false);
});

test('caps are validated and can never exceed the 24-request session limit', async (t) => {
  const harness = await createMockHarness({ reference });
  t.after(harness.close);
  for (const caps of [{ generation: 25, embedding: 24 }, { generation: 24, embedding: 25 }, { generation: 0, embedding: 24 }, { generation: 24, embedding: 1.5 }]) {
    await assert.rejects(runAcceptanceCampaign({ catalog: harness.catalog, config: harness.config, store: harness.store, testCases: [], taskId: SUNRISE, profileId: 'mock', caps }), /cap must be an integer between 1 and 24/);
  }
  assert.equal(MAX_SESSION_CAP, 24);
});
