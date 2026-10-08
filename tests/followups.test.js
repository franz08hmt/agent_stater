import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFollowups, validateFollowup } from '../src/agent/followups.js';
import { buildCatalog } from '../config/catalog.config.js';
import { createScriptedModel } from '../src/model/mock.js';
import { harness, TASK, final } from './helpers.js';

async function fixture(t, replies) {
  const h = await harness({ replies: [final('CAM1: 2 available.', ['http-status'])] });
  t.after(h.cleanup);
  // Persist an independently known completed result, not a manufactured expected from a tool.
  const run = { run_id: 'run_translation', goal: 'Read CAM1.', task_id: TASK.id, model_profile_id: 'test', task_fingerprint: TASK.fingerprint,
    status: 'completed', final: { answer: 'CAM1: 2 available.', source_ids: ['http-status'], unresolved: '' }, approvals: [], metrics: { historical: true }, trace: [] };
  const model = createScriptedModel(replies);
  const catalog = await buildCatalog({ tasks: [TASK], profiles: [{ id: 'test', label: 'Test', model, config: { provider: 'mock', name: model.name, timeoutMs: 1000, maxOutputTokens: 800 } }], defaultTaskId: TASK.id, defaultProfileId: 'test' });
  run.model_identity = catalog.profiles.get('test').identity; await h.store.saveRun(run);
  const service = createFollowups({ catalog, store: h.store }); await service.init();
  return { ...h, service, run, catalog, model };
}
const response = (answer = 'CAM1: còn 2.', source_ids = ['http-status']) => JSON.stringify({ answer, source_ids });

test('follow-up binds original final, persists separate accounting, never rewrites history or executes tools', async (t) => {
  const f = await fixture(t, [response()]); const before = (await f.store.loadRuns())[0];
  const result = await f.service.ask(f.run.run_id, 'Giải thích lại bằng tiếng Việt.');
  assert.equal(result.status, 'REVIEW_REQUIRED'); assert.equal(result.answer, 'CAM1: còn 2.');
  assert.equal(result.metrics.model_calls, 1); assert.equal(result.metrics.provider_requests, 0);
  assert.equal(result.metrics.tokens.status, 'estimated');
  assert.deepEqual((await f.store.loadRuns())[0], before);
  assert.equal((await f.store.listProposals()).length, 0); assert.equal((await f.store.listDrafts()).length, 0);
  const restarted = createFollowups({ catalog: f.catalog, store: f.store }); await restarted.init();
  assert.equal((await restarted.get(f.run.run_id)).results.length, 1);
  assert.equal(f.model.calls.length, 1);
  const context = JSON.parse(f.model.calls[0][1].content);
  assert.equal(Object.hasOwn(context, 'original_goal'), false, 'old goal language is irrelevant to explicit follow-up translation');
});

test('new business goal, nonfinal run, unknown context and changed identity are blocked before inference', async (t) => {
  const f = await fixture(t, [response()]);
  for (const text of ['Create a proposal.', 'Translate previous answer and save it.', 'Explain how to book CAM1.', '']) await assert.rejects(f.service.ask(f.run.run_id, text), /new run|rephrase/i);
  await assert.rejects(f.service.ask('run_other', 'Translate the previous answer into English.'), /context|run/i);
  f.catalog.profiles.get('test').identity = 'changed';
  await assert.rejects(f.service.ask(f.run.run_id, 'Nói ngắn gọn hơn bằng tiếng Việt.'), /changed/i);
  assert.equal(f.model.calls.length, 0);
});

test('follow-up rejects changed numbers, missing IDs, fake source, tool calls and false write outcome', async (t) => {
  const f = await fixture(t, []);
  const input = { final: f.run.final, approvals: [] };
  for (const reply of [response('CAM1: còn 12.'), response('còn 2.'), response('CAM1: còn 2.', ['fake']), JSON.stringify({ type: 'tool_call', tool: 'save_draft', arguments: {} })]) assert.throws(() => validateFollowup(reply, input), /source|number|identifier|protocol/i);
  const writing = { final: { answer: 'Proposal not saved.', source_ids: ['http-status'] }, approvals: [{ result_kind: 'proposal', state: 'rejected' }] };
  assert.throws(() => validateFollowup(response('Đã lưu đề xuất; chưa áp dụng thay đổi.'), writing), /outcome/i);
  assert.equal(validateFollowup(response('Không lưu đề xuất.'), writing).status, 'PASS');
  assert.throws(() => validateFollowup(response('Không lưu đề xuất.'), writing, { language: 'English' }), /outcome|language/i);
  assert.equal(validateFollowup(response('Proposal not saved.'), writing, { language: 'English' }).status, 'PASS');
  const enumRun = { ...input, final: { ...input.final, answer: 'CAM1: 2 available; status open.' }, messages: [{ content: 'OBSERVATION ' + JSON.stringify({ status: 'ok', untrusted_data: { results: [{ rows: [{ record: { asset_code: 'CAM1', status: 'open' } }] }] } }) }] };
  assert.throws(() => validateFollowup(response('CAM1: còn 2; trạng thái mở.'), enumRun), /enum/);
  assert.equal(validateFollowup(response('CAM1: còn 2; trạng thái open.'), enumRun).status, 'REVIEW_REQUIRED');
  assert.throws(() => validateFollowup(response('CAM1: 2 available.'), input, { language: 'English', concise: true }), /shorter/);
  assert.equal(validateFollowup(response('CAM1: 2.'), input, { language: 'English', concise: true }).status, 'REVIEW_REQUIRED');
});

test('follow-up session is finite, isolated across runs and restart does not refresh budget', async (t) => {
  const f = await fixture(t, [response(), response(), response(), response()]);
  for (let i = 0; i < 3; i++) await f.service.ask(f.run.run_id, 'Translate the previous answer into English.');
  const restarted = createFollowups({ catalog: f.catalog, store: f.store }); await restarted.init();
  await assert.rejects(restarted.ask(f.run.run_id, 'Translate the previous answer into English.'), /budget/i);
  await f.store.saveRun({ ...f.run, run_id: 'run_second', final: { ...f.run.final, answer: 'CAM1: 2 available.' } });
  await restarted.ask('run_second', 'Giải thích lại bằng tiếng Việt.');
  assert.equal(f.model.calls.length, 4);
  assert.equal((await restarted.get(f.run.run_id)).metrics.model_calls, 3);
  assert.equal((await restarted.get('run_second')).metrics.model_calls, 1);
});
