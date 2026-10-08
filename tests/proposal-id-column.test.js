import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, LIMITS } from './helpers.js';
import { loadTaskConfig } from '../config/task.config.js';
import { buildCatalog } from '../config/catalog.config.js';
import { createAgentRunner } from '../src/agent/runner.js';
import { createFileStore } from '../src/store/fileStore.js';
import { createScriptedModel } from '../src/model/mock.js';
import { PROPOSAL_CASES, proposalObservations, gradeProposal, runProposalSuite } from '../src/operations/proposalSuite.js';

for (const [format, taskId, caseId, columns] of [
  ['JSON', 'proposal-tickets', 'ticket-approve', { tickets: 'ticket_id' }],
  ['CSV', 'proposal-rooms', 'room-approve', { classes: 'class_code', rooms: 'room_code' }],
]) test(`proposal demo/grader respects declared ${format} ID columns through lookup, approval, store and replay`, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'proposal-ids-'));
  t.after(async () => {
    assert.ok(root.startsWith(join(tmpdir(), 'proposal-ids-')));
    await rm(root, { recursive: true, force: true });
  });
  for (const directory of ['config', 'data']) await cp(join(ROOT, directory), join(root, directory), { recursive: true });
  const taskFile = join(root, 'config', `${taskId}.task.json`), raw = JSON.parse(await readFile(taskFile, 'utf8'));
  for (const def of raw.data.datasets) {
    const column = columns[def.id], file = join(root, def.file);
    if (format === 'JSON') {
      const rows = JSON.parse(await readFile(file, 'utf8'));
      for (const row of rows) { row[column] = row[def.id_column]; delete row[def.id_column]; }
      await writeFile(file, JSON.stringify(rows));
    } else {
      const csv = await readFile(file, 'utf8');
      await writeFile(file, csv.replace(/^id,/, `${column},`));
    }
    def.columns.find((c) => c.name === def.id_column).name = column; def.id_column = column;
  }
  await writeFile(taskFile, JSON.stringify(raw));
  const task = await loadTaskConfig({ root, file: taskFile }), c = PROPOSAL_CASES.find((c) => c.id === caseId);
  const config = { model: { provider: 'mock', name: 'scripted-mock', timeoutMs: 2000 }, limits: { ...LIMITS, tokenBudget: 100000, maxProviderRequests: 12 } };
  const catalog = await buildCatalog({ tasks: [task], profiles: [{ id: 'mock', label: 'Mock', config: config.model }], defaultTaskId: task.id, defaultProfileId: 'mock' });
  const entry = catalog.tasks.get(task.id), store = await createFileStore({ root: join(root, 'runtime') });
  const evidence = (messages) => proposalObservations(messages).flatMap((o) => o.untrusted_data?.results || []);
  // Independent scripted decisions let the backend succeed even before the demo helper is fixed.
  const model = createScriptedModel([
    ...c.references.map((ref) => ({ type: 'tool_call', tool: 'query_dataset', arguments: { dataset_id: ref.dataset_id, operation: 'lookup',
      filters: [{ field: columns[ref.dataset_id], op: 'eq', value: ref.record_id }], limit: 1 } })),
    (messages) => ({ type: 'tool_call', tool: 'create_proposal', arguments: { action: c.action, changes: c.changes, reason: 'Requested internal proposal only.',
      references: c.references.map((ref) => ({ ...ref, source_id: evidence(messages).find((e) => e.dataset_id === ref.dataset_id).source_id })) } }),
    (messages) => ({ type: 'final', answer: 'Proposal saved; changes not applied.', source_ids: evidence(messages).map((e) => e.source_id), unresolved: '' }),
  ]);
  const runner = createAgentRunner({ model, task, registry: entry.registry, retriever: entry.retriever, store, limits: config.limits, modelTimeoutMs: 2000 });
  await runner.init();
  const started = await runner.startRun(c.goal); await runner.idle(started.run_id);
  const pending = runner.getRun(started.run_id), approval = pending.approvals.at(-1);
  assert.equal(pending.status, 'awaiting_approval');
  const body = { decision: 'approve', args_hash: approval.args_hash };
  await runner.decideApproval(pending.run_id, approval.approval_id, body); await runner.idle(pending.run_id);
  const replayed = (await runner.decideApproval(pending.run_id, approval.approval_id, body)).replayed;
  const run = runner.getRun(pending.run_id), stored = (await store.loadRuns())[0], proposals = await store.listProposals();
  assert.equal(run.status, 'completed'); assert.equal(proposals.length, 1); assert.equal(replayed, true);
  assert.equal((await gradeProposal(c, run, stored, task, proposals, replayed)).status, 'PASS', 'successful backend proposal must not receive a false grader failure');
  for (const mutate of [
    (r, p) => p[0].references[0].record_id = 'different-record',
    (r, p) => p[0].references[0].source_id = 'invented-source',
    (r, p) => p[0].references[0].dataset_version = 'different-snapshot',
    (r, p) => p[0].args_hash = 'different-hash',
    (r) => r.final.source_ids = ['invented-source'],
  ]) {
    const r = structuredClone(run), p = structuredClone(proposals); mutate(r, p);
    assert.equal((await gradeProposal(c, r, stored, task, p, replayed)).status, 'FAIL', 'ID adaptation must preserve record/source/version/hash checks');
  }
  const demo = await runProposalSuite({ env: { root, config, catalog }, cases: PROPOSAL_CASES.filter((c) => c.taskId === task.id) });
  assert.equal(demo.status, 'PASS', JSON.stringify(demo.results.map(({ id, status, reason }) => ({ id, status, reason }))));
  assert.ok(demo.results.every((r) => r.dataset_unchanged)); assert.equal(demo.session.provider_requests, 0);
  for (const trial of demo.results) for (const d of trial.decisions.filter((d) => d.tool === 'query_dataset')) {
    assert.equal(d.arguments.filters[0].field, columns[d.arguments.dataset_id]);
  }
});
