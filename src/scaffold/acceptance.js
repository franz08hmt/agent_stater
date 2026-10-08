// Offline executable acceptance. Expected values come only from the manifest.
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadTaskConfig } from '../../config/task.config.js';
import { createConfiguredToolRegistry } from '../tools/registry.js';
import { createKeywordRetriever } from '../retrieval/keywordSearch.js';
import { createAgentRunner } from '../agent/runner.js';
import { createFileStore } from '../store/fileStore.js';
import { createScriptedModel } from '../model/mock.js';
import { scriptedProposalDecision, gradeProposal, proposalObservations } from '../operations/proposalSuite.js';
import { invariantFailures } from '../../eval/checks.js';
import { buildSystemPrompt } from '../../config/prompts.js';
import { canonicalJson } from '../agent/state.js';
import { readBounded, safePath } from './files.js';
import { manifestSchema, assertSchema, validateCases, OFFLINE_CONFIG } from './spec.js';

const same = (a, b) => canonicalJson(a) === canonicalJson(b);
export function gradeReadEvidence(c, run, evidence, datasets) {
  const errors = [], ids = [...new Set(evidence.map((e) => e.source_id))];
  if (!same([...run.final.source_ids].sort(), [...ids].sort()) || ids.some((id) => !run.retrieved_source_ids.includes(id))) errors.push('Cited sources differ from actual run evidence.');
  if (c.tool === 'search_notes') {
    if (evidence.length !== c.expected.result_count || !same([...ids].sort(), [...c.expected.sources].sort())) errors.push('Note count/source differs from declared expected.');
    if (c.expected.contains && !evidence.some((e) => e.text.includes(c.expected.contains))) errors.push('Expected note passage not returned.');
    return errors;
  }
  const data = datasets.find((d) => d.id === c.args.dataset_id), e = evidence[0];
  const query = { operation: c.tool === 'compare_counts' ? 'compare' : c.args.operation, filters: c.args.filters || [] };
  if (c.args.field !== undefined) query.field = c.args.field;
  if (query.operation === 'compare') query.compare_filters = c.args.compare_filters;
  if (query.operation === 'lookup') query.limit = c.args.limit ?? 5;
  if (!e || evidence.length !== 1 || !data || e.dataset_id !== data.id || e.dataset_version !== data.version || !same(e.query, query)) return [...errors, 'Query, dataset or snapshot differs from the case.'];
  for (const [key, value] of Object.entries(c.expected)) {
    const actual = key === 'record_ids' ? e.rows?.map(({ record }) => record[data.idColumn]) : key === 'value' ? String(e.value) : key === 'values' ? e.values?.map(String) : e[key];
    if (!same(actual, value)) errors.push(`Declared expected ${key} differs from observed result.`);
  }
  return errors;
}
export function acceptanceDecision(c, messages, datasets) {
  if (c.kind === 'proposal') return scriptedProposalDecision({ ...c, blocked: c.expected.outcome === 'blocked', rule: c.expected.error_contains }, messages, datasets);
  const observations = proposalObservations(messages), evidence = observations.filter((o) => o.status === 'ok').flatMap((o) => o.untrusted_data?.results || []);
  const ids = [...new Set(evidence.map((e) => e.source_id))];
  if (!observations.length) return { type: 'tool_call', tool: c.kind === 'draft' ? 'search_notes' : c.tool, arguments: c.args };
  if (c.kind === 'draft' && !observations.some((o) => o.tool === 'save_draft')) return { type: 'tool_call', tool: 'save_draft', arguments: { ...c.draft, source_ids: ids } };
  const saved = observations.some((o) => o.tool === 'save_draft' && o.status === 'ok');
  return { type: 'final', answer: c.kind === 'draft' ? saved ? 'Saved.' : 'Not saved.' : c.kind === 'blocked' ? 'Blocked.' : c.answer,
    source_ids: c.kind === 'blocked' ? [] : ids, unresolved: c.unresolved || (c.kind === 'blocked' ? 'Backend rejected the requested operation.' : '') };
}
function gradeDraft(c, run, evidence, drafts, replayed) {
  const a = run.approvals.at(-1), approved = c.decision === 'approve', errors = [];
  const sources = [...new Set(evidence.map((e) => e.source_id))].sort();
  if (!same(sources, [...c.expected.sources].sort()) || !same([...run.final.source_ids].sort(), sources)) errors.push('Draft sources differ from retrieved notes.');
  if (!a || a.tool !== 'save_draft' || a.state !== (approved ? 'executed' : 'rejected') || !replayed || drafts.length !== c.expected.drafts) errors.push('Draft approval/replay/store mismatch.');
  if (approved && (!drafts[0] || drafts[0].draft_id !== a?.approval_id || a?.result?.draft_id !== drafts[0].draft_id
    || drafts[0].content !== c.draft.content || drafts[0].title !== c.draft.title || !same(drafts[0].source_ids, a.arguments.source_ids))) errors.push('Stored draft does not match approved arguments.');
  if (run.final.answer !== (approved ? 'Saved.' : 'Not saved.')) errors.push('Draft final contradicts tool outcome.');
  return errors;
}
export async function runAcceptanceTask({ root, id }) {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(id)) throw new Error('Invalid task ID.');
  await safePath(root, `config/${id}.task.json`);
  const manifest = JSON.parse((await readBounded(root, `tests/${id}.acceptance.json`, 65536)).bytes);
  assertSchema(manifestSchema, manifest);
  if (manifest.task_id !== id) throw new Error('Acceptance manifest task ID mismatch.');
  const task = await loadTaskConfig({ root, file: join(root, `config/${id}.task.json`) });
  const registry = createConfiguredToolRegistry(task.allowedTools, task.datasets, task), retriever = await createKeywordRetriever({ dir: task.dataDir });
  validateCases(manifest.cases, task, registry, retriever);
  const results = [], start = Date.now();
  for (const c of manifest.cases) {
    const dir = await mkdtemp(join(tmpdir(), 'scaffold-acceptance-'));
    try {
      const store = await createFileStore({ root: dir }), model = createScriptedModel([(messages) => acceptanceDecision(c, messages, task.datasets)]);
      const runner = createAgentRunner({ task, registry, retriever, store, model, limits: OFFLINE_CONFIG.limits, modelTimeoutMs: OFFLINE_CONFIG.model.timeoutMs });
      await runner.init(); const started = await runner.startRun(c.goal); await runner.idle(started.run_id);
      let run = runner.getRun(started.run_id), replayed = false;
      if (run.status === 'awaiting_approval') {
        if (['proposal', 'draft'].includes(c.kind) && c.expected.outcome !== 'blocked') {
          const a = run.approvals.at(-1), body = { decision: c.decision, args_hash: a.args_hash };
          await runner.decideApproval(run.run_id, a.approval_id, body); await runner.idle(run.run_id);
          replayed = (await runner.decideApproval(run.run_id, a.approval_id, body)).replayed;
        } else await runner.stopRun(run.run_id);
        run = runner.getRun(run.run_id);
      }
      const stored = (await store.loadRuns())[0], observations = proposalObservations(stored.messages);
      const evidence = observations.filter((o) => o.status === 'ok').flatMap((o) => o.untrusted_data?.results || []);
      const proposals = await store.listProposals(), drafts = await store.listDrafts(), unchanged = await task.verifyCurrent();
      const systemPrompt = buildSystemPrompt({ task, tools: registry.describe(), limits: OFFLINE_CONFIG.limits });
      const errors = invariantFailures(run, { registry, systemPrompt, apiKey: '' });
      if (!unchanged) errors.push('Original data/config changed.');
      let status = 'PASS', reason = 'Declared expected outcomes, run evidence and unchanged data checked.';
      if (c.kind === 'proposal' && !errors.length) {
        const verdict = await gradeProposal({ ...c, taskId: id, blocked: c.expected.outcome === 'blocked', rule: c.expected.error_contains }, run, stored, task, proposals, replayed);
        status = verdict.status; reason = verdict.reason;
        if (proposals.length !== c.expected.proposals || drafts.length) errors.push('Proposal count differs from independently declared expected.');
      } else {
        if (run.status !== 'completed') errors.push(`Run ended as ${run.status}: ${run.failure?.code || ''}`);
        if (c.kind === 'blocked') {
          if (run.approvals.length || proposals.length || drafts.length || observations.some((o) => o.status === 'ok')
            || !observations.some((o) => o.tool === c.tool && o.status === 'rejected' && o.code === c.expected.code
              && (!c.expected.error_contains || o.errors.join('; ').includes(c.expected.error_contains)))) errors.push('Declared input/permission rejection did not occur without side effects.');
        } else if (c.kind === 'draft') errors.push(...gradeDraft(c, run, evidence, drafts, replayed));
        else {
          if (!observations.some((o) => o.tool === c.tool && o.status === 'ok')) errors.push('Expected read tool did not succeed.');
          errors.push(...gradeReadEvidence(c, run, evidence, task.datasets));
          if (run.final?.answer !== c.answer || (c.kind === 'empty' && c.tool === 'search_notes' && !run.final?.unresolved)) errors.push('Final differs from declared response or missing-evidence explanation.');
          if (run.approvals.length || drafts.length || proposals.length) errors.push('Read case caused a write/approval.');
        }
      }
      if (errors.length) { status = 'FAIL'; reason = errors.join('; '); }
      results.push({ id: c.id, status, reason, run_status: run.status, proposals: proposals.length, drafts: drafts.length, replayed,
        dataset_unchanged: unchanged, source_ids: run.final?.source_ids || [], metrics: run.metrics });
    } catch (error) { results.push({ id: c.id, status: 'FAIL', reason: error.code || 'Acceptance execution failed; inspect task/data and declared cases.', dataset_unchanged: await task.verifyCurrent() }); }
    finally {
      if (!dir.startsWith(join(tmpdir(), 'scaffold-acceptance-'))) throw new Error('Unsafe cleanup');
      await rm(dir, { recursive: true, force: true });
    }
  }
  return { status: ['FAIL', 'BLOCKED', 'REVIEW_REQUIRED', 'NOT_RUN'].find((s) => results.some((r) => r.status === s)) || 'PASS',
    model_evidence: 'SCRIPTED_SCAFFOLD_BACKEND_ONLY', task_id: id, task_fingerprint: task.fingerprint,
    datasets: task.datasets.map((d) => ({ id: d.id, version: d.version, id_column: d.idColumn })),
    provider_requests: results.reduce((n, r) => n + (r.metrics?.provider_requests || 0), 0), elapsed_ms: Date.now() - start, student_timing: 'NOT_RUN', results };
}
