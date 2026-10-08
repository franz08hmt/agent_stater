import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, cp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { scaffoldFixture } from './scaffold-helpers.js';
import { scaffoldProject } from '../src/scaffold/apply.js';
import { runAcceptanceTask, gradeReadEvidence } from '../src/scaffold/acceptance.js';
import { loadTaskConfig } from '../config/task.config.js';
import { createConfiguredToolRegistry } from '../src/tools/registry.js';
import { createAgentRunner } from '../src/agent/runner.js';
import { createScriptedModel } from '../src/model/mock.js';
import { createFileStore } from '../src/store/fileStore.js';
import { OFFLINE_CONFIG } from '../src/scaffold/spec.js';
import { proposalObservations } from '../src/operations/proposalSuite.js';

async function fixture(t) {
  const { root } = await scaffoldFixture(t);
  const spec = JSON.parse(await readFile(new URL('../templates/asset-loan.spec.json', import.meta.url), 'utf8'));
  await scaffoldProject({ root, spec, apply: true, register: true });
  const task = await loadTaskConfig({ root, file: join(root, 'config/exam-assets.task.json') });
  const registry = createConfiguredToolRegistry(task.allowedTools, task.datasets, task);
  return { root, spec, task, registry };
}
test('asset extension scaffold -> real runner acceptance; independent expected detects wrong quantities', async (t) => {
  const { root } = await fixture(t);
  const result = await runAcceptanceTask({ root, id: 'exam-assets' });
  assert.equal(result.status, 'PASS', JSON.stringify(result.results));
  assert.equal(result.provider_requests, 0);
  const file = join(root, 'tests/exam-assets.acceptance.json'), manifest = JSON.parse(await readFile(file, 'utf8'));
  manifest.cases.find((c) => c.id === 'available').expected.available = '12';
  await writeFile(file, JSON.stringify(manifest));
  assert.equal((await runAcceptanceTask({ root, id: 'exam-assets' })).status, 'FAIL');
});
test('asset tool schema, dataset permissions and business rules fail closed', async (t) => {
  const { registry, task } = await fixture(t);
  const args = { dataset_id: 'assets', record_id: 'CAM1', quantity: 2 };
  assert.equal(registry.check('check_asset_availability', args, {}).ok, true);
  for (const patch of [{ quantity: -1 }, { quantity: 0 }, { quantity: '2' }, { quantity: null }, { quantity: 21 }, { quantity: 1.5 },
    { dataset_id: 'secret' }, { file: 'data/anything.json' }]) assert.equal(registry.check('check_asset_availability', { ...args, ...patch }, {}).ok, false);
  const { quantity, ...missingQuantity } = args; assert.equal(registry.check('check_asset_availability', missingQuantity, {}).code, 'invalid_arguments');
  const denied = createConfiguredToolRegistry(['query_dataset'], task.datasets, task);
  assert.equal(denied.check('check_asset_availability', args, {}).code, 'tool_not_allowed');
  const out = await registry.get('check_asset_availability').execute({ ...args, quantity: 4 });
  assert.equal(out.results[0].eligible, false); assert.equal(out.results[0].available, '3');
  const missing = await registry.get('check_asset_availability').execute({ ...args, record_id: 'missing' });
  assert.equal(missing.results[0].eligible, false); assert.equal(missing.results[0].matched_count, 0);
  const c = { tool: 'check_asset_availability', args, expected: { matched_count: 1, record_ids: ['CAM1'], available: '3', requested: 2, eligible: true } };
  const good = await registry.get(c.tool).execute(args), e = good.results;
  const run = { final: { source_ids: [e[0].source_id] }, retrieved_source_ids: [e[0].source_id] };
  assert.deepEqual(gradeReadEvidence(c, run, e, task.datasets), []);
  for (const patch of [{ dataset_version: 'wrong' }, { source_id: 'fake' }, { available: '12' }, { eligible: false }]) {
    assert.ok(gradeReadEvidence(c, run, [{ ...e[0], ...patch }], task.datasets).length);
  }
});
test('asset proposal uses actual page evidence, unchanged data, approval concurrency/restart/replay', async (t) => {
  const { root, task, registry } = await fixture(t);
  const original = await readFile(join(root, 'data/exam-assets/assets.json'), 'utf8');
  const store = await createFileStore({ root: join(root, 'runtime') });
  const lookup = { type: 'tool_call', tool: 'query_dataset', arguments: { dataset_id: 'assets', operation: 'lookup', filters: [{ field: 'asset_code', op: 'eq', value: 'CAM1' }], limit: 1 } };
  const propose = (messages) => ({ type: 'tool_call', tool: 'create_proposal', arguments: { action: 'asset_loan',
    references: [{ role: 'subject', dataset_id: 'assets', record_id: 'CAM1', source_id: proposalObservations(messages)[0].untrusted_data.results[0].source_id }],
    changes: { quantity: 2 }, reason: 'Requested internal loan proposal only.' } });
  const finish = (messages) => ({ type: 'final', answer: 'Proposal saved; changes not applied.', source_ids: [proposalObservations(messages)[0].untrusted_data.results[0].source_id], unresolved: '' });
  const make = (replies) => createAgentRunner({ task, registry, store, model: createScriptedModel(replies), limits: OFFLINE_CONFIG.limits, modelTimeoutMs: 2000 });
  const runner = make([lookup, propose]); await runner.init();
  const start = await runner.startRun('Create a proposal to borrow 2 units of CAM1.'); await runner.idle(start.run_id);
  const pending = runner.getRun(start.run_id), a = pending.approvals[0]; assert.equal(pending.status, 'awaiting_approval');
  const internal = (await store.loadRuns())[0], tool = registry.get('create_proposal');
  for (const mutate of [
    (r) => r.record_evidence = [], (r) => r.record_evidence[0].record_ids = ['other'],
    (r) => r.record_evidence[0].dataset_version = 'wrong', (r) => r.record_evidence[0].source_id = 'fake',
    (r) => r.record_evidence[0].dataset_id = 'other', (r) => r.goal = 'Count assets.',
  ]) { const r = structuredClone(internal); mutate(r); assert.ok(tool.checkRules(a.arguments, { run: r }).length); }
  for (const changes of [{ quantity: 4 }, { quantity: -1 }, { quantity: '2' }, { quantity: 2, room: 'B202' }]) assert.ok(tool.checkRules({ ...a.arguments, changes }, { run: internal }).length);
  for (const operation of ['count', 'sum', 'compare']) {
    const args = { dataset_id: 'assets', operation, ...(operation === 'sum' ? { field: 'available' } : {}), ...(operation === 'compare' ? { compare_filters: [] } : {}) };
    const output = await registry.get('query_dataset').execute(args);
    assert.deepEqual(registry.get('query_dataset').captureEvidence(args, output), []);
    assert.ok(tool.checkRules({ ...a.arguments, references: [{ ...a.arguments.references[0], source_id: output.results[0].source_id }] }, { run: internal }).length);
  }
  const restarted = make([finish]); await restarted.init();
  const body = { decision: 'approve', args_hash: a.args_hash };
  await assert.rejects(restarted.decideApproval(start.run_id, a.approval_id, { ...body, args_hash: 'fake' }), { code: 'approval_mismatch' });
  const answers = await Promise.all([restarted.decideApproval(start.run_id, a.approval_id, body), restarted.decideApproval(start.run_id, a.approval_id, body)]);
  assert.equal(answers.filter((r) => r.replayed).length, 1); await restarted.idle(start.run_id);
  assert.equal((await store.listProposals()).length, 1); assert.equal(restarted.getRun(start.run_id).status, 'completed');
  const again = make([]); await again.init(); assert.equal((await again.decideApproval(start.run_id, a.approval_id, body)).replayed, true);
  assert.equal((await store.listProposals())[0].applied, false);
  assert.equal(await readFile(join(root, 'data/exam-assets/assets.json'), 'utf8'), original);
});
test('asset startup rejects invalid numeric mapping; policy helper mutation invalidates verifyCurrent in a project copy', async (t) => {
  const { root } = await fixture(t);
  const taskFile = join(root, 'config/exam-assets.task.json'), raw = JSON.parse(await readFile(taskFile, 'utf8'));
  raw.data.datasets[0].columns.find((c) => c.name === 'available').scale = 1;
  await writeFile(taskFile, JSON.stringify(raw)); await assert.rejects(loadTaskConfig({ root, file: taskFile }), /scale 0/);
  raw.data.datasets[0].columns.find((c) => c.name === 'available').scale = 0; await writeFile(taskFile, JSON.stringify(raw));
  await cp(new URL('../src', import.meta.url), join(root, 'src'), { recursive: true });
  await cp(new URL('../package.json', import.meta.url), join(root, 'package.json'));
  const script = `import {loadTaskConfig} from './config/task.config.js'; import {appendFile} from 'node:fs/promises'; const t=await loadTaskConfig({root:process.cwd(),file:process.cwd()+'/config/exam-assets.task.json'}); await appendFile('src/business/assetAvailability.js','\\n// changed business dependency'); console.log(await t.verifyCurrent());`;
  assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, encoding: 'utf8' }).trim(), 'false');
});
