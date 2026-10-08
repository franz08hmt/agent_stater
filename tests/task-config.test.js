import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { ROOT } from './helpers.js';
import { loadTaskConfig, validateTaskConfig } from '../config/task.config.js';
import { createConfiguredToolRegistry } from '../src/tools/registry.js';
import { createRun, transition } from '../src/agent/state.js';
import { createAgentRunner } from '../src/agent/runner.js';
import { createScriptedModel } from '../src/model/mock.js';
import { createKeywordRetriever } from '../src/retrieval/keywordSearch.js';
import { createFileStore } from '../src/store/fileStore.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const good = {
  id: 'exam-demo', title: 'Exam demo',
  mission: 'Answer only from retrieved notes. State missing evidence; save only on explicit request.',
  data: { notes_dir: 'data/notes' },
  allowed_tools: ['search_notes', 'save_draft'],
  sample_inputs: [{ label: 'Example', goal: 'Explain HTTP 401.' }],
  result_labels: { answer: 'Answer', sources: 'Sources', unresolved: 'Missing evidence' },
};

test('task file loads and resolves its notes under data', async () => {
  const task = await loadTaskConfig({ root: ROOT });
  assert.equal(task.id, 'study-notes');
  assert.equal(task.dataDir, join(ROOT, 'data', 'notes'));
  assert.equal(task.allowedTools[0], 'search_notes');
  assert.match(task.fingerprint, /^[a-f0-9]{64}$/);
});

test('a missing task file fails before startup', async () => {
  await assert.rejects(loadTaskConfig({ root: ROOT, file: join(ROOT, 'config', 'missing-task.json') }), /missing task file/);
});

test('compare_counts is scoped to ticket permissions and requires an allowed dataset at startup', async () => {
  const task = await loadTaskConfig({ root: ROOT, file: join(ROOT, 'config/rehearsal-tickets.task.json') });
  assert.ok(task.allowedTools.includes('compare_counts'));
  assert.ok(task.allowedTools.includes('query_dataset'));
  assert.equal((await loadTaskConfig({ root: ROOT })).allowedTools.includes('compare_counts'), false);
  await assert.rejects(validateTaskConfig({ ...good, allowed_tools: ['compare_counts'] }, ROOT), /compare_counts requires at least one allowed dataset/);
});

test('task config rejects unknown tools, duplicates and write without retrieval', async () => {
  await assert.rejects(validateTaskConfig({ ...good, allowed_tools: ['shell'] }, ROOT), /allowed_tools/);
  await assert.rejects(validateTaskConfig({ ...good, allowed_tools: ['search_notes', 'search_notes'] }, ROOT), /duplicate/i);
  await assert.rejects(validateTaskConfig({ ...good, allowed_tools: ['save_draft'] }, ROOT), /search_notes/);
});

test('task config rejects unsafe paths and invalid or extra fields', async () => {
  await assert.rejects(validateTaskConfig({ ...good, data: { notes_dir: '../outside' } }, ROOT), /notes_dir/);
  await assert.rejects(validateTaskConfig({ ...good, data: { notes_dir: 'C:/Windows' } }, ROOT), /notes_dir/);
  await assert.rejects(validateTaskConfig({ ...good, data: { notes_dir: 'data/no-such-notes' } }, ROOT), /notes_dir/);
  await assert.rejects(validateTaskConfig({ ...good, sample_inputs: [{ label: 'x', goal: '' }] }, ROOT), /sample_inputs/);
  await assert.rejects(validateTaskConfig({ ...good, extra: true }, ROOT), /extra/);
});

test('task fingerprint changes with permissions or mission', async () => {
  const a = await validateTaskConfig(good, ROOT);
  const b = await validateTaskConfig({ ...good, allowed_tools: ['search_notes'] }, ROOT);
  const c = await validateTaskConfig({ ...good, mission: `${good.mission} More.` }, ROOT);
  assert.notEqual(a.fingerprint, b.fingerprint);
  assert.notEqual(a.fingerprint, c.fingerprint);
});

test('only task-enabled built-in tools can execute', () => {
  const registry = createConfiguredToolRegistry(['search_notes']);
  assert.deepEqual(registry.describe().map((x) => x.name), ['search_notes']);
  assert.equal(registry.check('save_draft', {}, {}).code, 'tool_not_allowed');
  assert.throws(() => createConfiguredToolRegistry(['unknown']), /unavailable/);
});

test('changing task or notes cancels a saved pending approval on restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'task-switch-'));
  try {
    const store = await createFileStore({ root: dir });
    const model = createScriptedModel([]);
    const run = createRun({ goal: 'Save a draft', model, taskFingerprint: 'previous' });
    transition(run, 'awaiting_approval');
    run.approvals.push({ approval_id: 'apr_old', state: 'pending', tool: 'save_draft', arguments: {}, args_hash: 'old' });
    run.pending_approval = 'apr_old';
    await store.saveRun(run);
    const runner = createAgentRunner({
      model, registry: createConfiguredToolRegistry(['search_notes']),
      retriever: await createKeywordRetriever({ dir: join(ROOT, 'data', 'notes') }), store,
      limits: { maxSteps: 6 }, modelTimeoutMs: 1000,
      task: { fingerprint: 'new', mission: good.mission },
    });
    await runner.init();
    const restored = runner.getRun(run.run_id);
    assert.equal(restored.status, 'failed');
    assert.equal(restored.failure.code, 'task_changed');
    assert.equal(restored.pending_approval, null);
    assert.equal(restored.approvals[0].state, 'cancelled');
    await assert.rejects(runner.decideApproval(run.run_id, 'apr_old', { decision: 'approve', args_hash: 'old' }), (error) => error.code === 'approval_already_decided' || error.code === 'approval_tampered');
    assert.deepEqual(await store.listDrafts(), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
