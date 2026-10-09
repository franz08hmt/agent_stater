import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { selectRuns, cardModel, runSignature } from '../public/qa-board-model.js';
import { VI } from '../public/i18n.js';
import { sunriseFixture, call, final } from './rag-helpers.js';
import { ROOT } from './helpers.js';

const run = (n, over = {}) => ({ run_id: `run_${n}`, task_id: 'sunrise-clinic-rag', created_at: `2026-10-09T08:00:0${n}.000Z`, updated_at: `2026-10-09T08:00:1${n}.000Z`, status: 'completed', goal: `Question ${n}?`,
  final: { answer: `Answer ${n}.`, source_ids: ['kb-b-s10-c1'], unresolved: '' }, source_labels: { 'kb-b-s10-c1': '10. Updates' }, failure: null, active_ms: 8300, retrieval_calls: 1,
  metrics: { collection: 'collected', is_mock: false, provider_requests: 2 }, ...over });

test('the board shows the newest N questions of one task, in the order they were asked', () => {
  const runs = [run(5), run(1), run(3), run(2), run(4), run(6), run(7, { task_id: 'study-notes' })];
  assert.deepEqual(selectRuns(runs, { task: 'sunrise-clinic-rag', last: 5 }).map((r) => r.run_id), ['run_2', 'run_3', 'run_4', 'run_5', 'run_6']);
  assert.deepEqual(selectRuns(runs, { task: 'sunrise-clinic-rag', last: 2 }).map((r) => r.run_id), ['run_5', 'run_6']);
  assert.equal(selectRuns(runs, { task: '', last: 12 }).length, 7, 'no task filter shows every task');
  assert.equal(selectRuns(runs, { task: 'sunrise-clinic-rag', last: 99 }).length, 6, 'N is capped at 12 and never exceeds what exists');
  assert.equal(selectRuns(runs, { task: 'sunrise-clinic-rag', last: 0 }).length, 5, 'an invalid N falls back to 5');
});

test('"start fresh" hides everything up to and including the newest run, and shows later ones', () => {
  const runs = [run(1), run(2), run(3)];
  const since = runs.map((r) => r.created_at).sort().at(-1);
  assert.deepEqual(selectRuns(runs, { task: 'sunrise-clinic-rag', since }), []);
  assert.deepEqual(selectRuns([...runs, run(4)], { task: 'sunrise-clinic-rag', since }).map((r) => r.run_id), ['run_4']);
});

test('a card has the question, the answer and "section — source_id"; a run without an answer never shows one', () => {
  const card = cardModel(run(2), 2);
  assert.deepEqual([card.number, card.question, card.answer, card.sources, card.seconds, card.llmRequests], [2, 'Question 2?', 'Answer 2.', ['10. Updates — kb-b-s10-c1'], 8.3, 2]);
  assert.equal(cardModel(run(8, { goal: '\n4. A Sunrise Plus member pays?\n' }), 8).question, '4. A Sunrise Plus member pays?', 'stray line breaks around the question are trimmed');
  const failed = cardModel(run(3, { status: 'failed', final: null, failure: { code: 'invalid_model_output', message: 'bad' } }), 3);
  assert.deepEqual([failed.answer, failed.sources, failed.failure], ['', [], 'invalid_model_output: bad']);
  const running = cardModel(run(4, { status: 'running', final: null }), 4);
  assert.equal(running.answer, '');
  assert.equal(cardModel(run(5, { final: { answer: 'No.', source_ids: [], unresolved: 'Not in the KB.' } }), 5).gap, 'Not in the KB.');
  assert.deepEqual(cardModel(run(6, { source_labels: undefined }), 6).sources, ['kb-b-s10-c1'], 'an unlabelled source falls back to its id');
  assert.equal(cardModel(run(7, { metrics: { collection: 'collected', is_mock: true, provider_requests: 0 } }), 7).llmRequests, null, 'mock runs show no request count');
});

test('a card is redrawn only when its run changes', () => {
  assert.equal(runSignature(run(1)), runSignature(run(1)));
  assert.notEqual(runSignature(run(1)), runSignature(run(1, { status: 'running' })));
  assert.notEqual(runSignature(run(1)), runSignature(run(1, { updated_at: '2026-10-09T08:09:09.000Z' })));
  assert.equal(runSignature(run(1, { active_ms: 99999 })), runSignature(run(1)), 'a ticking clock alone does not force a redraw');
});

test('page contract: no inline script or style (the CSP forbids them), semantic structure, text written with textContent', async () => {
  const html = await readFile(`${ROOT}/public/qa-board.html`, 'utf8');
  assert.doesNotMatch(html, /<style|\sstyle=|\sonclick=|<script(?![^>]*\ssrc=)/i);
  assert.match(html, /<main>[\s\S]*<section id="board"/);
  assert.match(html, /<h1 id="board-title"/);
  const js = await readFile(`${ROOT}/public/qa-board.js`, 'utf8');
  assert.doesNotMatch(js, /innerHTML|insertAdjacentHTML|document\.write|eval\(/);
  assert.doesNotMatch(js, /method:\s*'(POST|PUT|DELETE)'/, 'the board only reads');
});

test('every UI string of the board has a Vietnamese translation', async () => {
  const js = await readFile(`${ROOT}/public/qa-board.js`, 'utf8');
  const html = await readFile(`${ROOT}/public/qa-board.html`, 'utf8');
  const keys = new Set([...js.matchAll(/\bt\('([^']+)'\)/g)].map((m) => m[1]).concat([...html.matchAll(/data-i18n(?:-aria-label)?="([^"]+)"/g)].map((m) => m[1])));
  assert.ok(keys.size > 15);
  for (const key of keys) assert.ok(VI[key], `missing Vietnamese string for "${key}"`);
});

test('served by the backend with the security headers, and the board only reads: it never starts a run or calls a model', async (t) => {
  const f = await sunriseFixture(t, { replies: [call('dermatology fee'), final('500,000 VND.', ['kb-b-s10-c1'])] });
  const base = await f.serve();
  for (const [path, type] of [['/qa-board.html', /text\/html/], ['/qa-board.css', /text\/css/], ['/qa-board.js', /javascript/], ['/qa-board-model.js', /javascript/]]) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('content-type'), type);
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  }
  const llmBefore = f.model.calls.length, embedBefore = f.fake.embedHits().length;
  for (let i = 0; i < 3; i++) { await fetch(`${base}/api/runs`); await fetch(`${base}/api/catalog`); }
  assert.equal(f.model.calls.length, llmBefore, 'reading the list calls no model');
  assert.equal(f.fake.embedHits().length, embedBefore, 'and no embedding');
});
