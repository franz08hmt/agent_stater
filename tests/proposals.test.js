import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, cp, mkdtemp, rm, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadTaskConfig, validateTaskConfig } from '../config/task.config.js';
import { createConfiguredToolRegistry } from '../src/tools/registry.js';
import { createAgentRunner } from '../src/agent/runner.js';
import { createScriptedModel } from '../src/model/mock.js';
import { createFileStore } from '../src/store/fileStore.js';
import { ROOT, LIMITS, final } from './helpers.js';
import { POLICIES, proposalRequested } from '../src/proposals/policies.js';

const originalFiles = ['tickets.json', 'classes.csv', 'rooms.csv', 'proposal-classes.csv', 'proposal-rooms.csv'];
async function originals() { return Promise.all(originalFiles.map((f) => readFile(join(ROOT, 'data/datasets', f), 'utf8'))); }
export const lookup = (dataset_id, id, limit = 5) => ({ type: 'tool_call', tool: 'query_dataset', arguments: {
  dataset_id, operation: 'lookup', filters: id ? [{ field: 'id', op: 'eq', value: id }] : [], limit,
} });
export function observations(messages) {
  return messages.filter((m) => m.content.startsWith('OBSERVATION')).map((m) => JSON.parse(m.content.slice(m.content.indexOf('{'))));
}
export function proposalDecision(messages, room = false) {
  const results = observations(messages).flatMap((o) => o.untrusted_data?.results || []);
  return { type: 'tool_call', tool: 'create_proposal', arguments: {
    action: room ? 'class_room' : 'ticket_status',
    references: results.map((e, i) => ({ role: i ? 'target' : 'subject', dataset_id: e.dataset_id,
      record_id: e.rows[0].record.id, source_id: e.source_id })),
    changes: room ? { room: 'B202' } : { status: 'closed' }, reason: 'Requested internal proposal only.',
  } };
}
export async function proposalHarness(t, { room = false, goal, mutate, subject, target, root = ROOT, limit, limits = {}, replies, model } = {}) {
  const task = await loadTaskConfig({ root, file: join(root, `config/proposal-${room ? 'rooms' : 'tickets'}.task.json`) });
  assert.ok(task.sampleInputs.every(({ goal }) => proposalRequested(goal)), 'UI examples must authorize the requested backend proposal check');
  const registry = createConfiguredToolRegistry(task.allowedTools, task.datasets, task);
  const dir = await mkdtemp(join(tmpdir(), 'proposal-test-')), store = await createFileStore({ root: dir });
  t.after(() => rm(dir, { recursive: true, force: true }));
  const reads = [lookup(room ? 'classes' : 'tickets', subject ?? (room ? 'c01' : 'T2'), limit)];
  if (room) reads.push(lookup('rooms', target ?? 'R4'));
  const propose = (messages) => {
    const d = proposalDecision(messages, room); mutate?.(d.arguments); return d;
  };
  const base = model ?? createScriptedModel(replies ?? [...reads, propose, (messages) => {
    const obs = observations(messages), saved = obs.some((o) => o.tool === 'create_proposal' && o.status === 'ok');
    return final(saved ? 'Proposal saved; changes not applied.' : obs.some((o) => o.write_outcome === 'unknown') ? 'Proposal outcome unknown.' : 'Proposal not saved.',
      obs.flatMap((o) => o.untrusted_data?.results?.map((e) => e.source_id) || []));
  }]);
  const runner = createAgentRunner({ model: base, registry, task, store, limits: { ...LIMITS, ...limits }, modelTimeoutMs: 2000 });
  await runner.init();
  return { runner, store, task, registry, dir, model: base, goal: goal ?? (room ? 'Create a proposal to move class c01 to room B202.' : 'Create a proposal to change ticket T2 status to closed.'),
    async run() { const r = await runner.startRun(this.goal); await runner.idle(r.run_id); return runner.getRun(r.run_id); } };
}
async function approve(h, r, decision = 'approve') {
  const a = r.approvals.at(-1), body = { decision, args_hash: a.args_hash };
  const response = await h.runner.decideApproval(r.run_id, a.approval_id, body); await h.runner.idle(r.run_id);
  return { a, body, response, run: h.runner.getRun(r.run_id) };
}

for (const room of [false, true]) test(`proposal ${room ? 'class-room' : 'ticket-status'}: lookup -> approval -> exact store -> replay, original data unchanged`, async (t) => {
  const before = await originals(), h = await proposalHarness(t, { room });
  const r = await h.run(); assert.equal(r.status, 'awaiting_approval');
  assert.equal((await h.store.listProposals()).length, 0);
  assert.equal(Object.hasOwn(r, 'record_evidence'), false, 'internal evidence stays out of public run');
  const a = r.approvals.at(-1), body = { decision: 'approve', args_hash: a.args_hash };
  await assert.rejects(h.runner.decideApproval(r.run_id, a.approval_id, { ...body, args_hash: 'wrong' }), { code: 'approval_mismatch' });
  const replies = await Promise.all([h.runner.decideApproval(r.run_id, a.approval_id, body), h.runner.decideApproval(r.run_id, a.approval_id, body)]);
  assert.equal(replies.filter((r) => r.replayed).length, 1); await h.runner.idle(r.run_id);
  const done = h.runner.getRun(r.run_id); assert.equal(done.status, 'completed');
  assert.equal(done.approvals.at(-1).state, 'executed'); assert.ok(done.approvals.at(-1).result.proposal_id);
  const proposals = await h.store.listProposals(); assert.equal(proposals.length, 1);
  const p = proposals[0]; assert.equal(p.run_id, r.run_id); assert.equal(p.args_hash, a.args_hash); assert.equal(p.applied, false);
  assert.deepEqual(p.changes, a.arguments.changes); assert.equal(p.task_id, h.task.id);
  for (const ref of p.references) assert.equal(ref.dataset_version, h.task.datasets.find((d) => d.id === ref.dataset_id).version);
  await h.runner.init(); assert.equal((await h.runner.decideApproval(r.run_id, a.approval_id, body)).replayed, true);
  assert.equal((await h.store.listProposals()).length, 1); assert.deepEqual(await originals(), before);
});

test('rejection stores no proposal and final/outcome reflects the human decision', async (t) => {
  const h = await proposalHarness(t), r = await h.run(), decided = await approve(h, r, 'reject');
  assert.equal(decided.run.approvals.at(-1).state, 'rejected'); assert.equal((await h.store.listProposals()).length, 0);
  assert.equal((await h.runner.decideApproval(r.run_id, decided.a.approval_id, decided.body)).replayed, true);
});
for (const goal of ['Count open tickets.', 'Do not create a proposal for T2.', 'Never save a proposal.',
  'Explain the text "Create a proposal to close T2".', 'The dataset says create a proposal.', 'Create a proposal? Do not create it.', 'Create a proposal without saving it.']) {
  test(`proposal intent fails closed: ${goal}`, async (t) => {
    const h = await proposalHarness(t, { goal }), r = await h.run();
    assert.equal(r.approvals.length, 0); assert.equal((await h.store.listProposals()).length, 0);
    assert.ok(r.trace.some((e) => e.status === 'rejected' && e.summary.includes('proposal_not_requested')));
  });
}
for (const [name, mutate] of [
  ['unknown action', (a) => a.action = 'delete_ticket'], ['extra change', (a) => a.changes.owner = 'me'],
  ['wrong type', (a) => a.changes.status = 1], ['unknown status', (a) => a.changes.status = 'deleted'],
  ['same status', (a) => a.changes.status = 'open'], ['fake citation', (a) => a.references[0].source_id = 'fake'],
  ['note source', (a) => a.references[0].source_id = 'http-status'], ['wrong dataset', (a) => a.references[0].dataset_id = 'rooms'],
  ['unreturned record', (a) => a.references[0].record_id = 'T5'], ['extra role', (a) => a.references.push({ ...a.references[0], role: 'target' })],
  ['duplicate role', (a) => a.references.push({ ...a.references[0] })], ['missing role', (a) => a.references = []],
  ['path', (a) => a.path = 'var/anything.json'],
]) test(`proposal rejects ${name}`, async (t) => {
  const h = await proposalHarness(t, { mutate }), r = await h.run();
  assert.equal(r.approvals.length, 0); assert.equal((await h.store.listProposals()).length, 0);
  assert.ok(r.trace.some((e) => e.tool_name === 'create_proposal' && e.status === 'rejected'));
});
test('closed ticket cannot transition back to open', async (t) => {
  const h = await proposalHarness(t, { subject: 'T3', mutate: (a) => a.changes.status = 'open' }), r = await h.run();
  assert.equal(r.approvals.length, 0); assert.ok(r.trace.some((e) => /transition/.test(e.summary)));
});
for (const [target, expected] of [['R3', /capacity/], ['R1', /current room/], ['missing', /record|undefined/i]]) {
  test(`class room target ${target} cannot create a proposal`, async (t) => {
    const h = await proposalHarness(t, { room: true, target, mutate: (a) => a.changes.room = target === 'R1' ? 'A101' : 'B201' });
    const r = await h.run(); assert.equal(r.approvals.length, 0); assert.equal((await h.store.listProposals()).length, 0);
    if (target !== 'missing') assert.ok(r.trace.some((e) => expected.test(e.summary)));
  });
}
test('record outside returned lookup page is not evidence; aggregates never grant record rights', async (t) => {
  for (const operation of ['lookup', 'count', 'sum', 'compare']) {
    const args = { dataset_id: 'tickets', operation, filters: [], ...(operation === 'lookup' ? { limit: 1 } : {}),
      ...(operation === 'sum' ? { field: 'hours' } : {}), ...(operation === 'compare' ? { compare_filters: [] } : {}) };
    const h = await proposalHarness(t, { replies: [{ type: 'tool_call', tool: 'query_dataset', arguments: args }, (messages) => {
      const source_id = observations(messages)[0].untrusted_data.results[0].source_id;
      return { type: 'tool_call', tool: 'create_proposal', arguments: { action: 'ticket_status',
        references: [{ role: 'subject', dataset_id: 'tickets', record_id: 'T2', source_id }], changes: { status: 'closed' }, reason: 'Requested proposal.' } };
    }, final('Not saved.', [], 'No valid record evidence.')] });
    const r = await h.run(); assert.equal(r.approvals.length, 0, operation); assert.equal((await h.store.listProposals()).length, 0);
  }
});
test('lookup evidence from another run or version cannot create an approval', async (t) => {
  const h = await proposalHarness(t), first = await h.run(), ref = first.approvals.at(-1).arguments;
  const other = createAgentRunner({ model: createScriptedModel([{ type: 'tool_call', tool: 'create_proposal', arguments: ref }, final('Not saved.', [], 'Need lookup.')]),
    registry: h.registry, task: h.task, store: h.store, limits: LIMITS, modelTimeoutMs: 2000 });
  await other.init(); const r = await other.startRun(h.goal); await other.idle(r.run_id);
  assert.equal(other.getRun(r.run_id).approvals.length, 0);
  const internal = (await h.store.loadRuns()).find((r) => r.run_id === first.run_id);
  internal.record_evidence[0].dataset_version = 'wrong'; await h.store.saveRun(internal); await h.runner.init();
  const decided = await approve(h, h.runner.getRun(first.run_id));
  assert.equal(decided.run.approvals.at(-1).state, 'failed'); assert.equal((await h.store.listProposals()).length, 0);
});
test('configuration changed on disk blocks approval without restart; restart cancels stale pending approval', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'proposal-config-')); t.after(() => rm(root, { recursive: true, force: true }));
  for (const file of ['config', 'data']) await cp(join(ROOT, file), join(root, file), { recursive: true });
  const h = await proposalHarness(t, { root }), r = await h.run();
  const file = join(root, 'data/datasets/tickets.json'), data = JSON.parse(await readFile(file, 'utf8'));
  data[1].status = 'closed'; await writeFile(file, JSON.stringify(data));
  const decided = await approve(h, r); assert.equal(decided.run.approvals.at(-1).state, 'failed');
  assert.equal((await h.store.listProposals()).length, 0);
  const fresh = await proposalHarness(t, { root, subject: 'T1' }), pending = await fresh.run();
  data[0].status = 'closed'; await writeFile(file, JSON.stringify(data));
  const nextTask = await loadTaskConfig({ root, file: join(root, 'config/proposal-tickets.task.json') });
  const restored = createAgentRunner({ model: fresh.model, registry: createConfiguredToolRegistry(nextTask.allowedTools, nextTask.datasets, nextTask), task: nextTask,
    store: fresh.store, limits: LIMITS, modelTimeoutMs: 2000 }); await restored.init();
  assert.equal(restored.getRun(pending.run_id).failure.code, 'task_changed');
  assert.equal(restored.getRun(pending.run_id).approvals.at(-1).state, 'cancelled');
  assert.equal((await fresh.store.listProposals()).length, 0);
});
test('policy configuration rejects unregistered code, bad mappings, missing roles or tool permission at startup', async () => {
  const raw = JSON.parse(await readFile(join(ROOT, 'config/proposal-tickets.task.json'), 'utf8'));
  for (const proposal_policies of [[{ policy_id: 'shell', datasets: { subject: 'tickets' } }],
    [{ policy_id: 'ticket-status', datasets: { subject: 'missing' } }], [{ policy_id: 'ticket-status', datasets: { target: 'tickets' } }],
    [{ policy_id: 'class-room', datasets: { subject: 'tickets', target: 'tickets' } }]]) {
    await assert.rejects(validateTaskConfig({ ...raw, proposal_policies }, ROOT));
  }
  await assert.rejects(validateTaskConfig({ ...raw, proposal_policies: [] }, ROOT));
  assert.equal(createConfiguredToolRegistry(['query_dataset']).check('create_proposal', {}, {}).code, 'tool_not_allowed');
});
test('proposal store publishes exactly once under concurrent calls and rejects key collisions', async (t) => {
  const h = await proposalHarness(t), r = await h.run(), p = await approve(h, r);
  const existing = (await h.store.listProposals())[0];
  const results = await Promise.all(Array.from({ length: 8 }, () => h.store.createProposalOnce(p.a.approval_id, existing)));
  assert.ok(results.every((r) => r.created === false)); assert.equal((await h.store.listProposals()).length, 1);
  await assert.rejects(h.store.createProposalOnce(p.a.approval_id, { ...existing, run_id: 'different' }), /collision/);
});

test('concurrent first publication is atomic and complete, including an already-aborted store request', async (t) => {
  const h = await proposalHarness(t), r = await h.run(); await approve(h, r); const record = (await h.store.listProposals())[0];
  const key = 'apr_concurrent', input = { ...record, proposal_id: key };
  const results = await Promise.all(Array.from({ length: 10 }, () => h.store.createProposalOnce(key, input)));
  assert.equal(results.filter((r) => r.created).length, 1); assert.deepEqual(await h.store.getProposal(key), input);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(h.store.createProposalOnce('apr_abort', { ...input, proposal_id: 'apr_abort' }, { signal: controller.signal }), { writeOutcome: 'not_saved' });
  assert.equal(await h.store.getProposal('apr_abort'), null);
});
test('budget stop and explicit stop before approval do not store proposals', async (t) => {
  for (const stop of ['budget', 'user']) {
    const h = await proposalHarness(t, { limits: { tokenBudget: 100000 } }), r = await h.run();
    if (stop === 'user') await h.runner.stopRun(r.run_id);
    else { const saved = (await h.store.loadRuns())[0]; saved.metrics.tokens.budget_used = 100000; await h.store.saveRun(saved); await h.runner.init(); await approve(h, r); }
    assert.equal(h.runner.getRun(r.run_id).status, 'stopped'); assert.equal((await h.store.listProposals()).length, 0);
  }
});
test('store failure cannot produce a saved claim or success outcome', async (t) => {
  const h = await proposalHarness(t), r = await h.run();
  h.store.createProposalOnce = async () => { throw Object.assign(new Error('fixture write error'), { writeOutcome: 'not_saved' }); };
  const result = await approve(h, r); assert.equal(result.run.approvals.at(-1).state, 'failed');
  assert.equal(result.run.approvals.at(-1).write_outcome, 'not_saved');
  assert.equal(result.run.final.answer, 'Proposal not saved.'); assert.equal((await h.store.listProposals()).length, 0);
});
test('write timeout aborts before delayed publication and reports uncertainty until restart reconciliation', async (t) => {
  const release = Promise.withResolvers(), entered = Promise.withResolvers(); t.after(() => release.resolve());
  const h = await proposalHarness(t, { limits: { toolTimeoutMs: 80 } }), r = await h.run();
  const save = h.store.createProposalOnce;
  h.store.createProposalOnce = async (...args) => { entered.resolve(); await release.promise; return save(...args); };
  const approval = approve(h, r); await entered.promise;
  const done = await approval;
  assert.equal(done.run.approvals.at(-1).write_outcome, 'unknown'); assert.equal(done.run.final.answer, 'Proposal outcome unknown.');
  release.resolve(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await h.store.listProposals()).length, 0);
  await h.runner.init(); assert.equal(h.runner.getRun(r.run_id).approvals.at(-1).write_outcome, 'not_saved');
  assert.equal((await h.runner.decideApproval(r.run_id, done.a.approval_id, done.body)).replayed, true);
});
test('cancellation during execution aborts the proposal without pretending its unknown outcome succeeded', async (t) => {
  const release = Promise.withResolvers(), entered = Promise.withResolvers(); t.after(() => release.resolve());
  const h = await proposalHarness(t), r = await h.run(), save = h.store.createProposalOnce;
  h.store.createProposalOnce = async (...args) => { entered.resolve(); await release.promise; return save(...args); };
  const a = r.approvals.at(-1), write = h.runner.decideApproval(r.run_id, a.approval_id, { decision: 'approve', args_hash: a.args_hash });
  await entered.promise; const stop = h.runner.stopRun(r.run_id); release.resolve(); await Promise.all([write, stop]);
  const stopped = h.runner.getRun(r.run_id); assert.equal(stopped.status, 'stopped'); assert.equal(stopped.approvals.at(-1).write_outcome, 'not_saved');
  assert.equal((await h.store.listProposals()).length, 0);
});
test('restart reconciles an interrupted committed proposal and replay never executes model or store again', async (t) => {
  const h = await proposalHarness(t), r = await h.run(), decided = await approve(h, r);
  const saved = (await h.store.loadRuns())[0]; saved.status = 'awaiting_approval'; saved.final = null;
  Object.assign(saved.approvals.at(-1), { state: 'executing', result: null, write_outcome: 'unknown' }); await h.store.saveRun(saved);
  const model = createScriptedModel([]), runner = createAgentRunner({ model, registry: h.registry, task: h.task, store: h.store, limits: LIMITS, modelTimeoutMs: 2000 });
  await runner.init(); const restored = runner.getRun(r.run_id);
  assert.equal(restored.failure.code, 'interrupted'); assert.equal(restored.approvals.at(-1).state, 'executed');
  assert.ok(restored.approvals.at(-1).result.proposal_id);
  assert.equal((await runner.decideApproval(r.run_id, decided.a.approval_id, decided.body)).replayed, true);
  assert.equal(model.calls.length, 0); assert.equal((await h.store.listProposals()).length, 1);
});
test('a false proposal saved final after reject is repaired or rejected within existing limits', async (t) => {
  const h = await proposalHarness(t), r = await h.run();
  const bad = createScriptedModel([final('Proposal saved; changes not applied.', r.retrieved_source_ids)]);
  const runner = createAgentRunner({ model: bad, registry: h.registry, task: h.task, store: h.store, limits: LIMITS, modelTimeoutMs: 2000 });
  await runner.init(); const a = r.approvals.at(-1);
  await runner.decideApproval(r.run_id, a.approval_id, { decision: 'reject', args_hash: a.args_hash }); await runner.idle(r.run_id);
  assert.equal(runner.getRun(r.run_id).failure.code, 'invalid_model_output'); assert.equal((await h.store.listProposals()).length, 0);
});

test('capacity rules compare exact decimals at a shared scale without Number rounding', () => {
  const datasets = { subject: { columns: [{ name: 'students', scale: 2 }] }, target: { columns: [{ name: 'capacity', scale: 2 }] } };
  const records = { subject: { room: 'A', students: '30.01' }, target: { room: 'B', capacity: '30.00' } };
  assert.match(POLICIES['class-room'].check(records, { room: 'B' }, datasets).join(), /capacity/);
  records.target.capacity = '30.01'; assert.deepEqual(POLICIES['class-room'].check(records, { room: 'B' }, datasets), []);
  records.target.capacity = '-1.00'; assert.ok(POLICIES['class-room'].check(records, { room: 'B' }, datasets).length);
});

test('actual filesystem write failure produces no proposal and no false saved final', async (t) => {
  const h = await proposalHarness(t), r = await h.run();
  const folder = join(h.dir, 'proposals'), backup = join(h.dir, 'proposals-backup');
  await rename(folder, backup); await writeFile(folder, 'fixture blocks directory access');
  const decided = await approve(h, r);
  assert.equal(decided.run.approvals.at(-1).state, 'failed'); assert.equal(decided.run.approvals.at(-1).write_outcome, 'not_saved');
  assert.equal(decided.run.final.answer, 'Proposal not saved.');
  await unlink(folder); await rename(backup, folder); assert.equal((await h.store.listProposals()).length, 0);
});

test('timeout after atomic publication remains unknown until restart confirms the one saved proposal', async (t) => {
  const release = Promise.withResolvers(); t.after(() => release.resolve());
  const h = await proposalHarness(t, { limits: { toolTimeoutMs: 80 } }), r = await h.run(), save = h.store.createProposalOnce;
  h.store.createProposalOnce = async (...args) => { const committed = await save(...args); await release.promise; return committed; };
  const decided = await approve(h, r);
  assert.equal(decided.run.approvals.at(-1).write_outcome, 'unknown'); assert.equal(decided.run.final.answer, 'Proposal outcome unknown.');
  assert.equal((await h.store.listProposals()).length, 1);
  release.resolve(); await h.runner.init();
  const restored = h.runner.getRun(r.run_id); assert.equal(restored.approvals.at(-1).state, 'executed');
  assert.equal(restored.approvals.at(-1).write_outcome, 'confirmed');
  assert.equal((await h.runner.decideApproval(r.run_id, decided.a.approval_id, decided.body)).replayed, true);
  assert.equal((await h.store.listProposals()).length, 1);
});
