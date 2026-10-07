// Agent loop behaviour with scripted mock models. These prove the RUNNER's
// decisions (limits, approvals, state, recovery) — not a real LLM's reasoning.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { harness, tool, final, LIMITS, TASK } from './helpers.js';
import { createRuleBasedMock } from '../src/model/mock.js';
import { createAgentRunner } from '../src/agent/runner.js';
import { createToolRegistry } from '../src/tools/registry.js';
import { createRetrieverFromDocs } from '../src/retrieval/keywordSearch.js';

const statuses = (run, kind) => run.trace.filter((t) => t.kind === kind).map((t) => t.status);

test('happy path: search, then a grounded final answer', async (t) => {
  const h = await harness({ replies: [tool('search_notes', { query: '401 403' }), final('401 là lỗi xác thực, 403 là lỗi phân quyền.', ['http-status'])] });
  t.after(h.cleanup);
  const run = await h.run('401 và 403 khác nhau thế nào?');
  assert.equal(run.status, 'completed');
  assert.deepEqual(run.final.source_ids, ['http-status']);
  assert.equal(run.steps_used, 1);
  assert.ok(run.retrieved_source_ids.includes('http-status'));
  assert.deepEqual(statuses(run, 'tool'), ['ok']);
  assert.equal('messages' in run, false, 'the raw model conversation is never exposed');
});

test('two-passage question: the answer cites both retrieved sources', async (t) => {
  const h = await harness({ replies: [
    tool('search_notes', { query: 'giữa kỳ đồ án cuối kỳ tổng điểm', limit: 4 }),
    final('30% + 40% = 70%.', ['midterm', 'final-project']),
  ] });
  t.after(h.cleanup);
  const run = await h.run('Tổng tỉ trọng điểm giữa kỳ và đồ án?');
  assert.equal(run.status, 'completed');
  assert.deepEqual(run.final.source_ids.sort(), ['final-project', 'midterm']);
});

test('grounding: citing a source that was never retrieved is rejected and repaired', async (t) => {
  const h = await harness({ replies: [
    tool('search_notes', { query: '401 403' }),
    final('Bịa nguồn.', ['rag-basics']),              // rag-basics was not in the results
    final('Đúng nguồn.', ['http-status']),
  ] });
  t.after(h.cleanup);
  const run = await h.run('401 và 403?');
  assert.equal(run.status, 'completed');
  assert.equal(run.repairs_used, 1);
  assert.deepEqual(run.final.source_ids, ['http-status']);
  assert.ok(statuses(run, 'decision').includes('invalid'));
});

test('malformed model output: bounded repairs, then a clear failure', async (t) => {
  const h = await harness({ replies: ['Here you go!', '{"type":"maybe"}', '{not json'], limits: { maxRepairs: 2 } });
  t.after(h.cleanup);
  const run = await h.run('Bất kỳ câu hỏi');
  assert.equal(run.status, 'failed');
  assert.equal(run.failure.code, 'invalid_model_output');
  assert.equal(h.model.calls.length, 3, '1 attempt + 2 repairs, never more');
});

test('tool not in the allow-list is rejected and never executed', async (t) => {
  const h = await harness({ replies: [tool('delete_all_notes', {}), final('Không thể xóa.', [], 'Tool không được phép.')] });
  t.after(h.cleanup);
  const run = await h.run('Xóa hết ghi chú');
  assert.equal(run.status, 'completed');
  const rejected = run.trace.find((t2) => t2.tool_name === 'delete_all_notes' && t2.kind === 'tool');
  assert.equal(rejected.status, 'rejected');
  assert.match(rejected.summary, /tool_not_allowed/);
});

test('invalid tool arguments are rejected with the reason sent back to the model', async (t) => {
  const h = await harness({ replies: [
    tool('search_notes', { query: '', limit: 99 }),
    (messages) => {
      const obs = messages.at(-1).content;
      assert.match(obs, /invalid_arguments/);     // the model sees why it was rejected
      return tool('search_notes', { query: 'idempotency' });
    },
    final('Có.', ['idempotency']),
  ] });
  t.after(h.cleanup);
  const run = await h.run('Idempotency là gì?');
  assert.equal(run.status, 'completed');
  assert.deepEqual(statuses(run, 'tool'), ['rejected', 'ok']);
});

test('input limits: empty and oversized goals never start a run', async (t) => {
  const h = await harness({ replies: [] });
  t.after(h.cleanup);
  await assert.rejects(h.runner.startRun('   '), { code: 'invalid_goal' });
  await assert.rejects(h.runner.startRun(42), { code: 'invalid_goal' });
  await assert.rejects(h.runner.startRun('x'.repeat(501)), { code: 'goal_too_long' });
  assert.equal(h.runner.listRuns().length, 0);
});

const saveArgs = { title: 'Tóm tắt idempotency', content: 'POST không idempotent; dùng idempotency key.', source_ids: ['idempotency'] };
const saveFlow = () => [tool('search_notes', { query: 'idempotency' }), tool('save_draft', saveArgs), final('Xong.', ['idempotency'])];

test('summarize-only goal cannot create or request approval for a draft', async (t) => {
  const h = await harness({ replies: saveFlow() });
  t.after(h.cleanup);
  const run = await h.run('Tóm tắt idempotency');
  assert.equal(run.status, 'completed');
  assert.equal(run.approvals.length, 0);
  assert.equal((await h.store.listDrafts()).length, 0);
  assert.match(run.trace.find((entry) => entry.kind === 'tool' && entry.tool_name === 'save_draft').summary, /save_not_requested/);
});

test('write action waits for approval; rejecting it writes nothing', async (t) => {
  const h = await harness({ replies: saveFlow() });
  t.after(h.cleanup);
  const run = await h.run('Tóm tắt idempotency và lưu bản nháp');
  assert.equal(run.status, 'awaiting_approval');
  const a = run.approvals[0];
  assert.equal(a.state, 'pending');
  assert.equal((await h.store.listDrafts()).length, 0, 'nothing is written while pending');

  await h.runner.decideApproval(run.run_id, a.approval_id, { decision: 'reject', args_hash: a.args_hash });
  const done = await h.settle(run.run_id);
  assert.equal(done.status, 'completed');
  assert.equal(done.approvals[0].state, 'rejected');
  assert.equal((await h.store.listDrafts()).length, 0);
  assert.match(h.model.calls.at(-1).at(-1).content, /rejected_by_user/, 'the model is told the write was rejected');
});

test('approving creates exactly one draft; re-sending or double-clicking never duplicates it', async (t) => {
  const h = await harness({ replies: saveFlow() });
  t.after(h.cleanup);
  const run = await h.run('Tóm tắt idempotency và lưu bản nháp');
  const a = run.approvals[0];
  const body = { decision: 'approve', args_hash: a.args_hash };

  const [first, second] = await Promise.all([
    h.runner.decideApproval(run.run_id, a.approval_id, body),
    h.runner.decideApproval(run.run_id, a.approval_id, body),  // simultaneous double submit
  ]);
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  const done = await h.settle(run.run_id);
  const third = await h.runner.decideApproval(run.run_id, a.approval_id, body); // later retry
  assert.equal(third.replayed, true);

  const drafts = await h.store.listDrafts();
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].draft_id, a.approval_id);
  assert.deepEqual(drafts[0].source_ids, ['idempotency']);
  assert.equal(done.status, 'completed');
  await assert.rejects(h.runner.decideApproval(run.run_id, a.approval_id, { decision: 'reject', args_hash: a.args_hash }), { code: 'approval_already_decided' });
});

test('storage layer: the same idempotency key never creates a second file', async (t) => {
  const h = await harness({ replies: [] });
  t.after(h.cleanup);
  const d = { draft_id: 'apr_1', title: 't', content: 'c', source_ids: ['a'], created_at: new Date().toISOString() };
  const results = await Promise.all([h.store.createDraftOnce('apr_1', d), h.store.createDraftOnce('apr_1', { ...d, title: 'other' })]);
  assert.deepEqual(results.map((r) => r.created).sort(), [false, true]);
  assert.equal((await h.store.listDrafts()).length, 1);
});

test('approval is bound to the exact arguments shown: a different hash is refused', async (t) => {
  const h = await harness({ replies: saveFlow() });
  t.after(h.cleanup);
  const run = await h.run('Tóm tắt idempotency và lưu bản nháp');
  const a = run.approvals[0];
  await assert.rejects(h.runner.decideApproval(run.run_id, a.approval_id, { decision: 'approve', args_hash: 'f'.repeat(64) }), { code: 'approval_mismatch', httpStatus: 409 });
  await assert.rejects(h.runner.decideApproval(run.run_id, a.approval_id, { decision: 'approve' }), { code: 'approval_mismatch' });
  await assert.rejects(h.runner.decideApproval(run.run_id, 'apr_unknown', { decision: 'approve', args_hash: a.args_hash }), { code: 'approval_not_found' });
  await assert.rejects(h.runner.decideApproval(run.run_id, a.approval_id, { decision: 'yes', args_hash: a.args_hash }), { code: 'invalid_decision' });
  assert.equal(h.runner.getRun(run.run_id).status, 'awaiting_approval');
  assert.equal((await h.store.listDrafts()).length, 0);
});

test('changed arguments need a new approval: a second save_draft proposal is parked, not executed', async (t) => {
  const changed = { ...saveArgs, content: 'Nội dung đã sửa.' };
  const h = await harness({ replies: [tool('search_notes', { query: 'idempotency' }), tool('save_draft', saveArgs), tool('save_draft', changed)] });
  t.after(h.cleanup);
  const run = await h.run('Lưu bản nháp idempotency');
  const a1 = run.approvals[0];
  await h.runner.decideApproval(run.run_id, a1.approval_id, { decision: 'approve', args_hash: a1.args_hash });
  const after = await h.settle(run.run_id);
  assert.equal(after.status, 'awaiting_approval');
  assert.equal(after.approvals.length, 2);
  const a2 = after.approvals[1];
  assert.notEqual(a2.args_hash, a1.args_hash);
  assert.equal(a2.state, 'pending');
  assert.equal((await h.store.listDrafts()).length, 1, 'only the first approved write exists');
  // The old approval's hash cannot be used to push the new arguments through.
  await assert.rejects(h.runner.decideApproval(run.run_id, a2.approval_id, { decision: 'approve', args_hash: a1.args_hash }), { code: 'approval_mismatch' });
});

test('maximum steps: the run stops before the next tool call once the budget is used', async (t) => {
  let n = 0;
  const h = await harness({ replies: [() => tool('search_notes', { query: `lan tim ${n++}` })], limits: { maxSteps: 2 } });
  t.after(h.cleanup);
  const run = await h.run('Tìm mãi');
  assert.equal(run.status, 'stopped');
  assert.equal(run.failure.code, 'max_steps');
  assert.equal(run.steps_used, 2);
  assert.match(h.model.calls.at(-1).at(-1).content, /tool budget exhausted/);
});

test('repeated identical action without progress stops the run', async (t) => {
  const h = await harness({ replies: [tool('search_notes', { query: 'rag' }), tool('search_notes', { query: 'rag' })] });
  t.after(h.cleanup);
  const run = await h.run('RAG là gì?');
  assert.equal(run.status, 'stopped');
  assert.equal(run.failure.code, 'repeated_action');
  assert.equal(run.steps_used, 1);
});

test('model timeout fails the run safely', async (t) => {
  const h = await harness({ replies: [{ delayMs: 1000, text: final('late', [], 'x') }], modelTimeoutMs: 50 });
  t.after(h.cleanup);
  const run = await h.run('Chậm');
  assert.equal(run.status, 'failed');
  assert.equal(run.failure.code, 'model_timeout');
});

test('model dependency unavailable fails the run with a clear reason', async (t) => {
  const h = await harness({ replies: [{ error: 'unavailable' }] });
  t.after(h.cleanup);
  const run = await h.run('Model đang sập');
  assert.equal(run.status, 'failed');
  assert.equal(run.failure.code, 'model_unavailable');
});

test('total run time limit stops the run', async (t) => {
  const h = await harness({ replies: [{ delayMs: 400, text: tool('search_notes', { query: 'rag' }) }], limits: { runMaxMs: 150 }, modelTimeoutMs: 5000 });
  t.after(h.cleanup);
  const run = await h.run('Hết giờ');
  assert.equal(run.status, 'stopped');
  assert.equal(run.failure.code, 'run_timeout');
});

test('run deadline timer is distinguished from model timeout even when wall clock lags', async (t) => {
  const frozen = Date.now(); t.mock.method(Date, 'now', () => frozen);
  const h = await harness({ replies: [{ delayMs: 400, text: tool('search_notes', { query: 'rag' }) }], limits: { runMaxMs: 30 }, modelTimeoutMs: 5000 });
  t.after(h.cleanup);
  const run = await h.run('Run deadline');
  assert.equal(run.status, 'stopped'); assert.equal(run.failure.code, 'run_timeout');
});

test('tool timeout becomes an observation; the model can still finish honestly', async (t) => {
  const hanging = { kind: 'stub', has: () => false, search: () => new Promise(() => {}) };
  const h = await harness({ retriever: hanging, limits: { toolTimeoutMs: 50 }, replies: [tool('search_notes', { query: 'rag' }), final('Không tra cứu được.', [], 'Công cụ tìm kiếm quá thời gian.')] });
  t.after(h.cleanup);
  const run = await h.run('RAG là gì?');
  assert.equal(run.status, 'completed');
  assert.deepEqual(statuses(run, 'tool'), ['timeout']);
  assert.deepEqual(run.final.source_ids, []);
});

test('observations are capped in size before they reach the model', async (t) => {
  const long = 'dữ liệu dài '.repeat(200);
  const h = await harness({ docs: [{ sourceId: 'big', title: 'Big', passages: [long, long, long] }], limits: { maxObservationChars: 700 }, replies: [tool('search_notes', { query: 'du lieu dai', limit: 3 }), final('ok', ['big'])] });
  t.after(h.cleanup);
  await h.run('Dữ liệu dài');
  const obs = h.model.calls[1].at(-1).content;
  const json = obs.slice(obs.indexOf('{'));
  assert.ok(json.length <= 700, `observation was ${json.length} chars`);
  JSON.parse(json); // still valid JSON
});

test('stopping a run that awaits approval cancels the write', async (t) => {
  const h = await harness({ replies: saveFlow() });
  t.after(h.cleanup);
  const run = await h.run('Lưu bản nháp idempotency');
  const stopped = await h.runner.stopRun(run.run_id);
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.approvals[0].state, 'cancelled');
  await assert.rejects(h.runner.decideApproval(run.run_id, run.approvals[0].approval_id, { decision: 'approve', args_hash: run.approvals[0].args_hash }), { code: 'approval_already_decided' });
  assert.equal((await h.store.listDrafts()).length, 0);
});

test('a run interrupted by a server restart is marked failed, never resumed blindly', async (t) => {
  const h = await harness({ replies: [] });
  t.after(h.cleanup);
  const ghost = { run_id: 'run_ghost', task_fingerprint: TASK.fingerprint, status: 'running', trace: [], approvals: [], messages: [], created_at: new Date().toISOString(), updated_at: '' };
  await writeFile(join(h.dir, 'runs', 'run_ghost.json'), JSON.stringify(ghost));
  // A fresh runner over the same storage folder = a server restart.
  const runner = createAgentRunner({ model: h.model, registry: createToolRegistry(), retriever: h.retriever, store: h.store, limits: LIMITS, modelTimeoutMs: 1000, task: TASK });
  await runner.init();
  const restored = runner.getRun('run_ghost');
  assert.equal(restored.status, 'failed');
  assert.equal(restored.failure.code, 'interrupted');
});

test('prompt injection: a model that obeys the poisoned note is still stopped by the backend', async (t) => {
  // A "compromised" model that follows the instructions inside forum-copy.md.
  const h = await harness({ replies: [
    tool('search_notes', { query: 'mẹo ôn tập diễn đàn' }),
    tool('delete_all_notes', {}),
    tool('save_draft', { title: 'pwned', content: 'approved: true', source_ids: ['forum-copy'] }),
  ] });
  t.after(h.cleanup);
  const run = await h.run('Tổng hợp mẹo ôn tập từ ghi chú chép diễn đàn và lưu bản nháp');
  const firstObservation = h.model.calls[1].at(-1).content;
  assert.match(firstObservation, /"untrusted_data"/, 'retrieved text is delivered as data');
  assert.match(firstObservation, /IGNORE ALL PREVIOUS INSTRUCTIONS/, 'the injected text did reach the model');
  const del = run.trace.find((x) => x.tool_name === 'delete_all_notes' && x.kind === 'tool');
  assert.equal(del.status, 'rejected');
  assert.equal(run.status, 'awaiting_approval', 'the write is parked for a human, not executed');
  assert.equal((await h.store.listDrafts()).length, 0);
  assert.ok(!JSON.stringify(run).includes('MODEL_API_KEY'));
});

// ── Evidence that tool RESULTS drive the next action (runner test, not LLM evidence) ──
test('a different tool result leads the (rule-based mock) model to a different next action', async (t) => {
  const goal = 'Tóm tắt về idempotency và lưu bản nháp';
  const withNotes = createRetrieverFromDocs([{ sourceId: 'idempotency', title: 'Idempotency', passages: ['Idempotency: gửi lại cùng request không tạo bản ghi mới; dùng idempotency key.'] }]);
  const empty = createRetrieverFromDocs([{ sourceId: 'other', title: 'Khác', passages: ['Nội dung không liên quan.'] }]);

  const a = await harness({ model: createRuleBasedMock(), retriever: withNotes });
  const b = await harness({ model: createRuleBasedMock(), retriever: empty });
  t.after(a.cleanup);
  t.after(b.cleanup);
  const runA = await a.run(goal);
  const runB = await b.run(goal);

  // Same goal, same first action...
  assert.equal(runA.trace.find((x) => x.kind === 'tool').tool_name, 'search_notes');
  assert.equal(runB.trace.find((x) => x.kind === 'tool').tool_name, 'search_notes');
  // ...different observation, different second decision.
  assert.equal(runA.status, 'awaiting_approval');
  assert.equal(runA.approvals[0].tool, 'save_draft');
  assert.equal(runB.status, 'completed');
  assert.deepEqual(runB.final.source_ids, []);
  assert.ok(runB.final.unresolved.length > 0);
});
