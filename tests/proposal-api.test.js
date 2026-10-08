import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { loadTaskConfig } from '../config/task.config.js';
import { createScriptedModel } from '../src/model/mock.js';
import { ROOT, LIMITS } from './helpers.js';
import { PROPOSAL_CASES, scriptedProposalDecision, runProposalSuite, gradeProposal } from '../src/operations/proposalSuite.js';
import { loadEnvironment } from '../src/operations/context.js';

test('proposal scripted acceptance exercises all five scenarios through real runner and strict outcome grading', async () => {
  const env = await loadEnvironment({ dotenv: false }), r = await runProposalSuite({ env });
  assert.equal(r.status, 'PASS', JSON.stringify(r.results.map(({ id, status, reason }) => ({ id, status, reason }))));
  assert.equal(r.results.length, 5); assert.equal(r.session.provider_requests, 0);
  assert.ok(r.results.every((r) => r.dataset_unchanged));
});
test('HTTP proposal run keeps evidence private, rejects bad hash, reloads pending, approve/replay, bounded list and completed restart', async (t) => {
  const c = PROPOSAL_CASES[0], task = await loadTaskConfig({ root: ROOT, file: join(ROOT, 'config/proposal-tickets.task.json') });
  const dir = await mkdtemp(join(tmpdir(), 'proposal-api-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const config = { model: { provider: 'mock', name: 'scripted-mock', timeoutMs: 2000 }, limits: LIMITS, server: { maxBodyBytes: 16384 } };
  const app = await createApp({ config, task, model: createScriptedModel([(messages) => scriptedProposalDecision(c, messages)]), varDir: dir, publicDir: join(ROOT, 'public') });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => app.server.close(resolve)));
  const url = `http://127.0.0.1:${app.server.address().port}`, post = (path, body) => fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const started = await (await post('/api/runs', { goal: c.goal })).json(); await app.runner.idle(started.run.run_id);
  const pending = (await (await fetch(url + `/api/runs/${started.run.run_id}`)).json()).run;
  assert.equal(pending.status, 'awaiting_approval'); assert.equal(Object.hasOwn(pending, 'record_evidence'), false);
  assert.equal((await (await fetch(url + '/api/proposals')).json()).proposals.length, 0);
  const a = pending.approvals.at(-1), path = `/api/runs/${pending.run_id}/approvals/${a.approval_id}`;
  assert.equal((await post(path, { decision: 'approve', args_hash: 'wrong' })).status, 409);
  const body = { decision: 'approve', args_hash: a.args_hash };
  await post(path, body); await app.runner.idle(pending.run_id); assert.equal((await (await post(path, body)).json()).replayed, true);
  assert.equal((await (await fetch(url + '/api/proposals?limit=1')).json()).proposals.length, 1);
  assert.equal((await fetch(url + '/api/proposals?limit=0')).status, 400);
  assert.equal((await fetch(url + '/api/proposals?limit=51')).status, 400);
  assert.equal((await fetch(url + '/api/proposals?path=elsewhere')).status, 400);
  await app.runner.init(); assert.equal((await (await post(path, body)).json()).replayed, true);
  assert.equal((await (await fetch(url + '/api/proposals')).json()).proposals.length, 1);
  const done = app.runner.getRun(pending.run_id), stored = (await app.store.loadRuns())[0], proposals = await app.store.listProposals();
  assert.equal((await gradeProposal(c, done, stored, task, proposals, true)).status, 'PASS');
  for (const mutate of [
    (r) => r.final.source_ids = ['invented-source'],
    (r, p) => p[0].changes.status = 'open',
    (r, p) => p[0].references[0].dataset_version = 'wrong-version',
    (r, p) => p[0].references[0].source_id = 'invented-source',
    (r, p) => p[0].references[0].record_id = 'T1',
    (r, p) => p[0].applied = true,
    (r) => r.final.answer = 'Changes applied.',
    (r) => r.approvals.at(-1).state = 'rejected',
  ]) {
    const r = structuredClone(done), p = structuredClone(proposals); mutate(r, p);
    assert.equal((await gradeProposal(c, r, stored, task, p, true)).status, 'FAIL', 'grader must reject false citations/action/outcome/version/records');
  }
});
