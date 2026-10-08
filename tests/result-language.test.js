import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProposalTool } from '../src/tools/createProposal.js';
import { buildSystemPrompt } from '../config/prompts.js';
import { TASK, LIMITS, harness, final } from './helpers.js';
import { saveDraft } from '../src/tools/saveDraft.js';

test('new runs carry goal language policy; legacy prompt remains compatible without it', async () => {
  const h = await harness({ replies: [final('Chưa có bằng chứng.', [], 'Thiếu dữ liệu.')] });
  try {
    const run = await h.run('Giải thích nội dung này bằng tiếng Anh.');
    assert.equal(run.language_policy, 'goal-natural-v1');
    assert.equal(run.goal, 'Giải thích nội dung này bằng tiếng Anh.');
    const args = { task: TASK, tools: [], limits: LIMITS };
    assert.match(buildSystemPrompt({ ...args, languagePolicy: run.language_policy }), /original goal.*language/is);
    assert.doesNotMatch(buildSystemPrompt(args), /goal-natural-v1/);
  } finally { await h.cleanup(); }
});

test('proposal final accepts finite VI or EN equivalents; contradicting outcome is rejected; legacy stays EN', () => {
  const tool = createProposalTool();
  const run = (state, result, write_outcome) => ({ language_policy: 'goal-natural-v1', approvals: [{ result_kind: 'proposal', state, result, write_outcome }] });
  const saved = run('executed', { proposal_id: 'p1' });
  assert.deepEqual(tool.checkFinal({ answer: 'Đã lưu đề xuất; chưa áp dụng thay đổi.' }, saved), []);
  assert.deepEqual(tool.checkFinal({ answer: 'Proposal saved; changes not applied.' }, saved), []);
  assert.ok(tool.checkFinal({ answer: 'Đã áp dụng thay đổi.' }, saved).length);
  assert.deepEqual(tool.checkFinal({ answer: 'Không lưu đề xuất.' }, run('rejected')), []);
  assert.ok(tool.checkFinal({ answer: 'Đã lưu đề xuất; chưa áp dụng thay đổi.' }, run('rejected')).length);
  assert.deepEqual(tool.checkFinal({ answer: 'Chưa xác định được kết quả lưu đề xuất.' }, run('failed', null, 'unknown')), []);
  assert.ok(tool.checkFinal({ answer: 'Không lưu đề xuất.' }, run('failed', null, 'unknown')).length);
  delete saved.language_policy;
  assert.ok(tool.checkFinal({ answer: 'Đã lưu đề xuất; chưa áp dụng thay đổi.' }, saved).length);
});

test('draft write intent comes from original request, never quoted or negated text', () => {
  const ctx = (goal) => ({ run: { goal, retrieved_source_ids: ['http-status'] }, retriever: { has: () => true } });
  const args = { source_ids: ['http-status'] };
  for (const goal of ['Do not save a draft.', 'Đừng lưu bản nháp.', 'Explain "save a draft".', 'Giải thích `lưu bản nháp`.']) {
    assert.match(saveDraft.checkRules(args, ctx(goal)).join(), /save_not_requested/);
  }
  for (const goal of ['Tóm tắt HTTP và lưu bản nháp.', 'Summarize HTTP and save a draft.']) assert.deepEqual(saveDraft.checkRules(args, ctx(goal)), []);
});

test('VI/EN finite draft confirmations distinguish saved, rejected and unknown without rewriting output', () => {
  for (const [state, result, write_outcome, vi, en] of [
    ['executed', { draft_id: 'd1' }, null, 'Đã lưu bản nháp.', 'Saved.'],
    ['rejected', null, null, 'Không lưu bản nháp.', 'Not saved.'],
    ['failed', null, 'unknown', 'Chưa xác định được kết quả lưu bản nháp.', 'Draft outcome unknown.'],
  ]) {
    const run = { approvals: [{ tool: 'save_draft', state, result, write_outcome }] };
    for (const answer of [vi, en]) assert.deepEqual(saveDraft.checkFinal({ answer }, run), []);
    const wrong = state === 'executed' ? 'Không lưu bản nháp.' : 'Đã lưu bản nháp.';
    assert.ok(saveDraft.checkFinal({ answer: wrong }, run).length);
  }
});

test('scripted VI/EN goal matrix preserves raw goal; explicit instruction is passed without a translation call', async () => {
  for (const [goal, answer] of [
    ['HTTP 429 có nghĩa gì?', 'HTTP 429 là giới hạn tần suất.'],
    ['Explain HTTP 429.', 'HTTP 429 indicates rate limiting.'],
    ['Giải thích HTTP 429 bằng tiếng Anh.', 'HTTP 429 indicates rate limiting.'],
    ['Explain HTTP 429 in Vietnamese.', 'HTTP 429 là giới hạn tần suất.'],
  ]) {
    const h = await harness({ replies: [final(answer, [], 'Scripted language example; no retrieved facts.')] });
    try { const r = await h.run(goal); assert.equal(r.goal, goal); assert.equal(r.final.answer, answer); assert.equal(r.metrics.model_calls, 1); }
    finally { await h.cleanup(); }
  }
});
