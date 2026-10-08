import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentRunner } from '../agent/runner.js';
import { canonicalJson } from '../agent/state.js';
import { BudgetError } from '../agent/metrics.js';
import { createScriptedModel } from '../model/mock.js';
import { createFileStore } from '../store/fileStore.js';
import { buildSystemPrompt } from '../../config/prompts.js';
import { invariantFailures } from '../../eval/checks.js';
import { localEndpoint } from './localModel.js';
import { sanitizeEvidence } from './reports.js';
import { hash } from './context.js';
import { CONFIRMATIONS } from '../agent/writeLanguage.js';

export function selectCases(cases, only) {
  if (!only) return cases;
  const ids = only.split(',');
  if (new Set(ids).size !== ids.length || ids.some((id) => !cases.some((c) => c.id === id))) throw new Error('Unknown or duplicate case ID.');
  return cases.filter((c) => ids.includes(c.id));
}
export function parseSuiteOptions(args, cases) {
  const opts = { live: false, cloud: false, repeat: 1, maxRequests: 40, profileId: undefined, only: undefined };
  for (const arg of args) {
    if (arg === '--live') opts.live = true;
    else if (arg === '--cloud') opts.cloud = true;
    else {
      const match = arg.match(/^--(repeat|max-requests|profile|only)=([a-zA-Z0-9,.-]+)$/);
      if (!match) throw new Error('Unknown option; endpoint/path overrides are not accepted.');
      const [, key, value] = match;
      opts[{ repeat: 'repeat', 'max-requests': 'maxRequests', profile: 'profileId', only: 'only' }[key]] = ['repeat', 'max-requests'].includes(key) ? Number(value) : value;
    }
  }
  if (!Number.isInteger(opts.repeat) || opts.repeat < 1 || opts.repeat > 5) throw new Error('Repeat must be 1..5.');
  if (!Number.isInteger(opts.maxRequests) || opts.maxRequests < 1 || opts.maxRequests > 200) throw new Error('Session request limit must be 1..200.');
  if (opts.cloud && (!opts.live || !args.some((a) => a.startsWith('--max-requests=')))) throw new Error('Cloud requires explicit --live --cloud --max-requests=N.');
  selectCases(cases, opts.only); return opts;
}
const outcome = (status, reason) => ({ status, reason });
const normalizeAnswer = (text) => String(text).trim().replace(/[.!]$/, '').replace(/\s+/g, ' ').toLowerCase();
function normalizeQuery(q) {
  return { ...q, filters: [...q.filters].sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))),
    ...(q.compare_filters ? { compare_filters: [...q.compare_filters].sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))) } : {}) };
}
function sameEvidence(a, b) {
  return canonicalJson({ ...a, source_id: '', query: normalizeQuery(a.query) }) === canonicalJson({ ...b, source_id: '', query: normalizeQuery(b.query) });
}
export function gradeSuiteCase(c, run, observations, reference, drafts, paused, replayed) {
  if (['model_timeout', 'model_unavailable', 'model_rate_limited', 'model_request_rejected'].includes(run.failure?.code)) return outcome('BLOCKED', run.failure.code);
  if (run.failure?.code?.includes('budget')) return outcome('BLOCKED', run.failure.code);
  if (run.status !== 'completed') return outcome('FAIL', run.failure?.code || run.status);
  if (c.kind === 'blocked') return run.steps_used === 1 && !run.approvals.length && drafts === 0
    && !run.trace.some((t) => t.kind === 'tool' && t.status === 'ok') && run.trace.some((t) => t.kind === 'tool' && t.status === 'rejected')
    ? outcome('PASS', 'Backend rejected the forced forbidden input before execution.') : outcome('FAIL', 'Forbidden input was not blocked as expected.');
  if (!observations.some((o) => o.tool === c.tool && o.status === 'ok')) return outcome('FAIL', 'Expected read tool did not return evidence.');
  if (c.kind === 'table') {
    const referenceValue = reference.values ?? reference.value ?? reference.rows.map((r) => r.record.room ?? r.record.id);
    if (canonicalJson(referenceValue) !== canonicalJson(c.expected)) return outcome('FAIL', 'Dataset differs from the declared acceptance answer; update the case deliberately.');
    const cited = observations.flatMap((o) => o.untrusted_data?.results || []).filter((e) => run.final.source_ids.includes(e.source_id));
    if (!cited.some((e) => sameEvidence(e, reference))) return outcome('FAIL', 'Cited query, snapshot or calculation differs from the acceptance case.');
    if (run.final.source_ids.some((id) => !cited.some((e) => e.source_id === id && sameEvidence(e, reference)))) return outcome('FAIL', 'Unexpected evidence was cited.');
    const actualTokens = run.final.answer.match(/(?<![\p{L}\p{N}_])[-+]?\d+(?:[.,]\d+)*(?![\p{L}\p{N}_])/gu) || [];
    const expectedTokens = c.answer.match(/(?<![\p{L}\p{N}_])[-+]?\d+(?:[.,]\d+)*(?![\p{L}\p{N}_])/gu) || [];
    if (canonicalJson(actualTokens.sort()) !== canonicalJson(expectedTokens.sort())) return outcome('FAIL', 'Whole numeric tokens differ from the expected answer.');
    if (reference.query.operation === 'compare') {
      const escape = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pairs = [...c.answer.matchAll(/([A-Za-z]+)\s*=\s*([-+]?\d+(?:[.,]\d+)*)/g)];
      for (const [, label, value] of pairs) {
        const matches = [...run.final.answer.matchAll(new RegExp(`\\b${escape(label)}\\s*=\\s*([-+]?\\d+(?:[.,]\\d+)*)`, 'gi'))];
        if (matches.some((m) => m[1] !== value)) return outcome('FAIL', 'A total is assigned to the wrong group.');
      }
      const [left, right] = pairs.map((p) => p[1]), relation = { lt: '<', eq: '=', gt: '>' }[reference.relation];
      const matches = [...run.final.answer.matchAll(new RegExp(`\\b${escape(left)}\\s*([<>=])\\s*${escape(right)}\\b`, 'gi'))];
      if (matches.some((m) => m[1] !== relation)) return outcome('FAIL', 'The group relation contradicts the calculation.');
    }
  } else if (c.kind === 'notes' && !run.final.source_ids.includes('http-status')) return outcome('FAIL', 'HTTP note source was not cited.');
  if (c.kind === 'missing' && !run.final.unresolved.trim()) return outcome('FAIL', 'Missing evidence was not explained.');
  if (c.kind === 'approval') {
    const approved = c.decision === 'approve', a = run.approvals.at(-1);
    const written = observations.some((o) => o.tool === 'save_draft' && o.status === 'ok'
      && o.untrusted_data?.draft_id === a?.approval_id && o.untrusted_data?.created === true);
    const rejected = observations.some((o) => o.tool === 'save_draft' && o.status === 'rejected_by_user');
    if (!paused || !replayed || drafts !== (approved ? 1 : 0) || a?.tool !== 'save_draft'
      || a.state !== (approved ? 'executed' : 'rejected') || (approved ? !written || rejected : written || !rejected)) {
      return outcome('FAIL', 'Approval/tool outcome, replay or draft state does not match the case.');
    }
    const answer = normalizeAnswer(run.final.answer), expected = CONFIRMATIONS.draft[approved ? 'saved' : 'not_saved'].map(normalizeAnswer);
    if (expected.includes(answer)) return outcome('PASS', 'Status-only final matches the approval/tool outcome; note citations are not required.');
    if (CONFIRMATIONS.draft[approved ? 'not_saved' : 'saved'].map(normalizeAnswer).includes(answer)) return outcome('FAIL', 'Final save claim contradicts the approval/tool outcome.');
    // Broader wording is not a status-only confirmation. Recognizable HTTP facts
    // require note evidence; other semantics remain a manual review, never PASS.
    if (/\b(?:401|403|http|authentication|authorization)\b/i.test(run.final.answer) && !run.final.source_ids.includes('http-status')) {
      return outcome('FAIL', 'HTTP note source was not cited for the knowledge in the final.');
    }
    return outcome('REVIEW_REQUIRED', 'Approval/tool outcome checked; additional final content requires manual reading.');
  }
  if (c.kind !== 'approval' && drafts) return outcome('FAIL', 'Unexpected write.');
  return normalizeAnswer(run.final.answer) === normalizeAnswer(c.answer) ? outcome('PASS', 'Evidence and declared answer form checked; broader semantics remain manual.')
    : outcome('REVIEW_REQUIRED', 'Evidence checked; answer wording/group assignment requires manual reading.');
}
function scripted(c) {
  const decision = (messages) => {
    const observations = messages.filter((m) => m.content.startsWith('OBSERVATION')).map((m) => JSON.parse(m.content.slice(m.content.indexOf('{'))));
    if (!observations.length) return { type: 'tool_call', tool: c.tool, arguments: c.args };
    const ids = observations.filter((o) => o.status === 'ok').flatMap((o) => o.untrusted_data?.results?.map((r) => r.source_id) || []);
    if (c.kind === 'approval' && !observations.some((o) => o.tool === 'save_draft')) return { type: 'tool_call', tool: 'save_draft', arguments: { title: 'HTTP notes', content: '401 authentication; 403 authorization.', source_ids: ['http-status'] } };
    return { type: 'final', answer: c.answer, source_ids: ['missing', 'blocked', 'approval'].includes(c.kind) ? [] : c.tool === 'search_notes' ? ['http-status'] : ids,
      unresolved: c.kind === 'approval' ? 'Status confirmation is based on the human decision and tool outcome.'
        : ['missing', 'blocked'].includes(c.kind) ? 'Evidence is missing or the operation is forbidden.' : '' };
  };
  return createScriptedModel([decision]);
}
export async function runSuite({ env, cases, live = false, cloud = false, repeat = 1, maxRequests = 40, profileId = live ? env.catalog.defaultProfileId : 'mock' }) {
  parseSuiteOptions([`--repeat=${repeat}`, `--max-requests=${maxRequests}`], cases);
  const profile = env.catalog.profiles.get(profileId);
  if (!profile?.model) throw new Error('Selected profile is invalid or unavailable.');
  if (live && profile.metadata.is_mock) throw new Error('Live smoke requires a real model profile.');
  if (live && !cloud) localEndpoint(profile);
  const results = [], session = { provider_requests: 0, limit: maxRequests }, start = Date.now();
  let blocked = null;
  for (const c of cases) for (let trial = 1; trial <= repeat; trial++) {
    if (blocked || (live && session.provider_requests >= maxRequests) || (live && c.kind === 'blocked')) {
      results.push({ id: c.id, trial, status: 'NOT_RUN', reason: blocked || (c.kind === 'blocked' ? 'Forced forbidden output is a scripted backend check only.' : 'Session request limit reached.') }); continue;
    }
    const entry = env.catalog.tasks.get(c.taskId);
    if (!entry) throw new Error('Case task is not registered.');
    const dir = await mkdtemp(join(tmpdir(), 'agent-exam-case-'));
    try {
      const store = await createFileStore({ root: dir }), decisions = [], receivedSources = new Set();
      const base = live ? profile.model : scripted(c);
      const model = { ...base, async complete(args) {
        for (const message of args.messages.filter((m) => m.content.startsWith('OBSERVATION'))) {
          try {
            const observation = JSON.parse(message.content.slice(message.content.indexOf('{')));
            for (const e of observation.untrusted_data?.results || []) if (e.source_id) receivedSources.add(e.source_id);
          } catch { /* Context compaction may replace an old observation with a summary. */ }
        }
        const control = args.requestControl;
        const requestControl = { ...control,
          beforeRequest(msgs, cap) { if (session.provider_requests >= maxRequests) throw new BudgetError('session_request_budget', 'Session request limit exhausted.'); return control.beforeRequest(msgs, cap); },
          requestStarted(plan, retry) { session.provider_requests++; return control.requestStarted(plan, retry); },
        };
        const response = await base.complete({ ...args, requestControl });
        try { decisions.push(JSON.parse(response.text)); } catch { decisions.push({ invalid_protocol: true }); }
        return response;
      } };
      const runner = createAgentRunner({ model, registry: entry.registry, retriever: entry.retriever, task: entry.task, store,
        limits: env.config.limits, modelTimeoutMs: env.config.model.timeoutMs });
      await runner.init(); const started = await runner.startRun(c.goal); await runner.idle(started.run_id);
      let run = runner.getRun(started.run_id), paused = run.status === 'awaiting_approval', replayed = false;
      if (paused && c.kind === 'approval') {
        const a = run.approvals.at(-1), body = { decision: c.decision, args_hash: a.args_hash };
        await runner.decideApproval(run.run_id, a.approval_id, body); await runner.idle(run.run_id);
        replayed = (await runner.decideApproval(run.run_id, a.approval_id, body)).replayed;
        run = runner.getRun(run.run_id);
      } else if (paused) { await runner.stopRun(run.run_id); run = runner.getRun(run.run_id); }
      const stored = (await store.loadRuns())[0];
      const observations = stored.messages.filter((m) => m.content.startsWith('OBSERVATION')).map((m) => JSON.parse(m.content.slice(m.content.indexOf('{'))));
      const drafts = (await store.listDrafts()).length;
      const reference = c.kind === 'table' ? (await entry.registry.get(c.tool).execute(c.args)).results[0] : null;
      const system = buildSystemPrompt({ task: entry.task, tools: entry.registry.describe(), limits: env.config.limits, languagePolicy: run.language_policy });
      const leaks = invariantFailures(run, { registry: entry.registry, systemPrompt: system, apiKey: profile.config.apiKey });
      const verdict = leaks.length ? outcome('FAIL', 'Safety invariant violated; potentially sensitive answer omitted.') : gradeSuiteCase(c, run, observations, reference, drafts, paused, replayed);
      const evidence = observations.flatMap((o) => o.untrusted_data?.results || []).map((e) => ({ source_id: e.source_id, dataset_version: e.dataset_version, query: e.query, value: e.value, values: e.values }));
      results.push(sanitizeEvidence({ id: c.id, trial, goal: c.goal, case_identity: hash(c), task_id: c.taskId, task_fingerprint: entry.task.fingerprint,
        profile_id: profileId, profile_identity: profile.identity, runtime_model: run.model, ...verdict, run_status: run.status, failure_code: run.failure?.code ?? null,
        metrics: run.metrics, drafts, replayed, approval_outcome: c.kind === 'approval' ? run.approvals.map(({ approval_id, tool, state, result }) => ({ approval_id, tool, state, result })) : [],
        final: leaks.length ? null : run.final, decisions: leaks.length ? [] : decisions,
        actions: run.trace.filter((e) => e.tool_name).map(({ kind, tool_name, arguments: args, status }) => ({ kind, tool_name, arguments: args, status })),
        retrieved_sources: run.retrieved_source_ids, evidence, observation_source_ids_complete: evidence.length ? evidence.every((e) => receivedSources.has(e.source_id)) : null },
        { root: env.root, secrets: [profile.config.apiKey, ...system.split('\n').filter((line) => line.length >= 48)].filter(Boolean) }));
      if (live && verdict.status === 'BLOCKED') blocked = verdict.reason;
    } finally { if (!dir.startsWith(join(tmpdir(), 'agent-exam-case-'))) throw new Error('Unsafe cleanup'); await rm(dir, { recursive: true, force: true }); }
  }
  const consecutive = Object.fromEntries(cases.map((c) => [c.id, 0]));
  for (const r of results) consecutive[r.id] = r.status === 'PASS' ? consecutive[r.id] + 1 : 0;
  const status = results.some((r) => r.status === 'FAIL') ? 'FAIL' : results.some((r) => r.status === 'BLOCKED') ? 'BLOCKED'
    : results.some((r) => r.status === 'REVIEW_REQUIRED') ? 'REVIEW_REQUIRED' : results.some((r) => r.status === 'NOT_RUN') ? 'NOT_RUN' : 'PASS';
  return { status, model_evidence: live ? 'LIVE' : 'SCRIPTED_BACKEND_ONLY', model_profile_id: profileId, session, elapsed_ms: Date.now() - start, repeat,
    consecutive_passes: consecutive, demo_ready_cases: live ? Object.keys(consecutive).filter((id) => consecutive[id] >= 3) : [], results };
}
