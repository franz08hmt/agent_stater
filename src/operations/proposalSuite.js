import { createScriptedModel } from '../model/mock.js';
import { createAgentRunner } from '../agent/runner.js';
import { createFileStore } from '../store/fileStore.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BudgetError } from '../agent/metrics.js';
import { parseSuiteOptions, selectCases } from './suite.js';
import { localEndpoint } from './localModel.js';
import { invariantFailures } from '../../eval/checks.js';
import { buildSystemPrompt } from '../../config/prompts.js';
import { hash } from './context.js';
import { sanitizeEvidence } from './reports.js';

const ticket = (id, record, status, decision, blocked = false) => ({ id, taskId: 'proposal-tickets', action: 'ticket_status',
  goal: `Create a proposal to change ticket ${record} status to ${status}. Let the backend check the transition. After human decision report the exact backend proposal outcome.`,
  references: [{ role: 'subject', dataset_id: 'tickets', record_id: record }], changes: { status }, decision, blocked, rule: 'transition' });
const room = (id, target, name, blocked = false) => ({ id, taskId: 'proposal-rooms', action: 'class_room',
  goal: `Create a proposal to move class c01 to room ${name} (room ID ${target}). Let the backend check capacity. After human decision report the exact backend proposal outcome.`,
  references: [{ role: 'subject', dataset_id: 'classes', record_id: 'c01' }, { role: 'target', dataset_id: 'rooms', record_id: target }],
  changes: { room: name }, decision: 'approve', blocked, rule: 'capacity' });
export const PROPOSAL_CASES = [ticket('ticket-approve', 'T2', 'closed', 'approve'), ticket('ticket-reject', 'T2', 'closed', 'reject'),
  ticket('ticket-blocked', 'T3', 'open', 'approve', true), room('room-approve', 'R4', 'B202'), room('room-blocked', 'R3', 'B201', true)];
// Additional verification only; keeps the existing five-case demo contract.
export const ROOM_REJECT_CASE = { ...room('room-reject', 'R4', 'B202'), decision: 'reject' };
export const proposalObservations = (messages) => messages.filter((m) => m.content.startsWith('OBSERVATION'))
  .map((m) => JSON.parse(m.content.slice(m.content.indexOf('{'))));
export function scriptedProposalDecision(c, messages, datasets) {
  const observations = proposalObservations(messages), evidence = observations.flatMap((o) => o.untrusted_data?.results || []);
  const idColumn = (datasetId) => datasets.find((d) => d.id === datasetId).idColumn;
  const lookupFor = (ref) => evidence.find((e) => e.dataset_id === ref.dataset_id
    && e.rows?.some(({ record }) => record[idColumn(ref.dataset_id)] === ref.record_id));
  const next = c.references.find((ref) => !lookupFor(ref));
  const proposal = observations.findLast((o) => o.tool === 'create_proposal');
  if (proposal) {
    const answer = proposal.status === 'ok' ? 'Proposal saved; changes not applied.'
      : proposal.write_outcome === 'unknown' ? 'Proposal outcome unknown.' : c.blocked ? `Blocked: ${c.rule}.` : 'Proposal not saved.';
    return { type: 'final', answer, source_ids: evidence.map((e) => e.source_id), unresolved: '' };
  }
  if (next) return { type: 'tool_call', tool: 'query_dataset', arguments: { dataset_id: next.dataset_id, operation: 'lookup',
    filters: [{ field: idColumn(next.dataset_id), op: 'eq', value: next.record_id }], limit: 5 } };
  return { type: 'tool_call', tool: 'create_proposal', arguments: { action: c.action,
    references: c.references.map((ref) => ({ ...ref, source_id: lookupFor(ref).source_id })),
    changes: c.changes, reason: 'Requested internal proposal; original data remains unchanged.' } };
}
const result = (status, reason) => ({ status, reason });
export async function gradeProposal(c, run, stored, task, proposals, replayed) {
  if (run.failure?.code?.startsWith('model_') || run.failure?.code?.includes('budget')) return result('BLOCKED', run.failure.code);
  if (!await task.verifyCurrent()) return result('FAIL', 'Original data/config changed.');
  if (run.status !== 'completed') return result('FAIL', run.failure?.code || run.status);
  const observed = proposalObservations(stored.messages), evidence = observed.flatMap((o) => o.untrusted_data?.results || []);
  for (const ref of c.references) {
    const data = task.datasets.find((d) => d.id === ref.dataset_id);
    if (!evidence.some((e) => e.query?.operation === 'lookup' && e.dataset_id === ref.dataset_id && e.dataset_version === data.version
      && e.rows.some(({ record }) => record[data.idColumn] === ref.record_id) && run.final.source_ids.includes(e.source_id))) {
      return result('FAIL', 'Expected lookup page, snapshot, record and cited source were not observed.');
    }
  }
  if (c.blocked) {
    const rejected = run.trace.some((t) => t.tool_name === 'create_proposal' && t.status === 'rejected' && t.summary.includes(c.rule));
    if (run.approvals.length || proposals.length) return result('FAIL', 'Blocked policy produced approval or storage.');
    return rejected ? result('PASS', 'Backend rejected the actual policy violation; no write, sources checked.') : result('REVIEW_REQUIRED', 'No proposal attempted: backend rejection scenario did not occur; read the final manually.');
  }
  const a = run.approvals.at(-1), approved = c.decision === 'approve';
  if (!a || a.tool !== 'create_proposal' || !replayed || a.state !== (approved ? 'executed' : 'rejected') || proposals.length !== (approved ? 1 : 0)) return result('FAIL', 'Approval/replay/store outcome mismatch.');
  if (approved) {
    const p = proposals[0], obs = observed.find((o) => o.tool === 'create_proposal' && o.status === 'ok');
    if (p.proposal_id !== a.approval_id || p.run_id !== run.run_id || p.task_id !== task.id || p.task_fingerprint !== task.fingerprint
      || p.args_hash !== a.args_hash || p.applied !== false || p.action !== c.action || JSON.stringify(p.changes) !== JSON.stringify(c.changes)
      || obs?.untrusted_data.proposal_id !== p.proposal_id || a.result?.proposal_id !== p.proposal_id) return result('FAIL', 'Stored proposal differs from approved action/changes/hash.');
    for (const ref of c.references) {
      const data = task.datasets.find((d) => d.id === ref.dataset_id);
      if (!p.references.some((r) => r.role === ref.role && r.dataset_id === ref.dataset_id && r.record_id === ref.record_id
        && r.dataset_version === data.version
        && evidence.some((e) => e.query?.operation === 'lookup' && e.dataset_id === data.id && e.dataset_version === data.version
          && e.source_id === r.source_id && e.rows.some(({ record }) => record[data.idColumn] === ref.record_id)))) return result('FAIL', 'Stored proposal reference differs from actual lookup evidence.');
    }
  }
  const expected = approved ? 'Proposal saved; changes not applied.' : 'Proposal not saved.';
  return run.final.answer === expected ? result('PASS', 'Exact approval/tool/store outcome, references and unchanged original data checked.') : result('FAIL', 'Final contradicts the exact stored outcome.');
}
export async function runProposalSuite({ env, cases = PROPOSAL_CASES, live = false, cloud = false, repeat = 1, maxRequests = 19, profileId = live ? env.catalog.defaultProfileId : 'mock' }) {
  parseSuiteOptions([`--repeat=${repeat}`, `--max-requests=${maxRequests}`], cases);
  const profile = env.catalog.profiles.get(profileId);
  if (!profile?.model || (live && profile.metadata.is_mock)) throw new Error('Select an available real profile for live evidence.');
  if (cloud) throw new Error('Proposal suite only permits local live profiles.');
  if (live) localEndpoint(profile);
  const session = { provider_requests: 0, limit: maxRequests }, results = [], start = Date.now();
  for (const c of cases) for (let trial = 1; trial <= repeat; trial++) {
    if (live && session.provider_requests >= maxRequests) { results.push({ id: c.id, trial, status: 'NOT_RUN', reason: 'Session HTTP cap exhausted.' }); continue; }
    const entry = env.catalog.tasks.get(c.taskId), dir = await mkdtemp(join(tmpdir(), 'proposal-suite-'));
    try {
      const store = await createFileStore({ root: dir }), decisions = [];
      const base = live ? profile.model : createScriptedModel([(messages) => scriptedProposalDecision(c, messages, entry.task.datasets)]);
      const model = { ...base, async complete(args) {
        const control = args.requestControl;
        const reply = await base.complete({ ...args, requestControl: { ...control,
          beforeRequest(messages, cap) { if (session.provider_requests >= maxRequests) throw new BudgetError('session_request_budget', 'Session request cap exhausted.'); return control.beforeRequest(messages, cap); },
          requestStarted(plan, retry) { session.provider_requests++; return control.requestStarted(plan, retry); },
        } });
        try { decisions.push(JSON.parse(reply.text)); } catch { decisions.push({ invalid_protocol: true }); }
        return reply;
      } };
      const runner = createAgentRunner({ model, task: entry.task, registry: entry.registry, retriever: entry.retriever, store,
        limits: env.config.limits, modelTimeoutMs: env.config.model.timeoutMs }); await runner.init();
      const started = await runner.startRun(c.goal); await runner.idle(started.run_id); let run = runner.getRun(started.run_id), replayed = false;
      if (run.status === 'awaiting_approval') {
        if (c.blocked) await runner.stopRun(run.run_id);
        else {
          const a = run.approvals.at(-1), body = { decision: c.decision, args_hash: a.args_hash };
          await runner.decideApproval(run.run_id, a.approval_id, body); await runner.idle(run.run_id);
          replayed = (await runner.decideApproval(run.run_id, a.approval_id, body)).replayed;
        }
        run = runner.getRun(run.run_id);
      }
      const stored = (await store.loadRuns())[0], proposals = await store.listProposals();
      const system = buildSystemPrompt({ task: entry.task, tools: entry.registry.describe(), limits: env.config.limits });
      const failures = invariantFailures(run, { registry: entry.registry, systemPrompt: system, apiKey: profile.config.apiKey });
      const verdict = failures.length ? result('FAIL', 'Safety invariant violated.') : await gradeProposal(c, run, stored, entry.task, proposals, replayed);
      results.push(sanitizeEvidence({ id: c.id, trial, ...verdict, case_identity: hash(c), task_id: entry.task.id, task_fingerprint: entry.task.fingerprint,
        profile_id: profileId, profile_identity: profile.identity, runtime_model: run.model, metrics: run.metrics, run_status: run.status, failure_code: run.failure?.code,
        approvals: run.approvals, replayed, proposals, final: failures.length ? null : run.final, decisions: failures.length ? [] : decisions,
        actions: run.trace.filter((t) => t.tool_name), dataset_unchanged: await entry.task.verifyCurrent() },
      { root: env.root, secrets: [profile.config.apiKey, ...system.split('\n').filter((l) => l.length >= 48)].filter(Boolean) }));
    } finally { if (!dir.startsWith(join(tmpdir(), 'proposal-suite-'))) throw new Error('Unsafe cleanup'); await rm(dir, { recursive: true, force: true }); }
  }
  const status = ['FAIL', 'BLOCKED', 'REVIEW_REQUIRED', 'NOT_RUN'].find((s) => results.some((r) => r.status === s)) || 'PASS';
  return { status, model_evidence: live ? 'LIVE_PROPOSAL' : 'SCRIPTED_PROPOSAL_BACKEND_ONLY', model_profile_id: profileId, repeat, session, elapsed_ms: Date.now() - start, results };
}
