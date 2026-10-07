import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { readReport } from './reports.js';
import { SMOKE_CASES, REHEARSAL_CASES } from './cases.js';
import { inspectPort } from './launcher.js';
import { readTiming } from './timing.js';

async function recentReports(env) {
  let names;
  try { names = await readdir(join(env.root, 'var/exam')); } catch (err) { if (err.code === 'ENOENT') return []; throw err; }
  const files = await Promise.all(names.filter((n) => /^[a-z-]+-[0-9a-f-]{36}\.json$/.test(n)).map(async (name) => ({ name, info: await stat(join(env.root, 'var/exam', name)) })));
  const records = [];
  for (const { name, info } of files.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs).slice(0, 50)) {
    if (info.size > 4 * 1024 * 1024) { records.push({ report: { report_id: name.slice(0, -5), status: 'REVIEW_REQUIRED', kind: 'unreadable' }, stale: true }); continue; }
    try { records.push(await readReport(env, name.slice(0, -5))); }
    catch { records.push({ report: { report_id: name.slice(0, -5), status: 'REVIEW_REQUIRED', kind: 'unreadable' }, stale: true }); }
  }
  return records;
}
const missing = () => ({ status: 'NOT_RUN' });
async function studentTiming(env) {
  let names;
  try { names = await readdir(join(env.root, 'var/exam/timings')); } catch (err) { if (err.code === 'ENOENT') return []; throw err; }
  const sessions = [];
  for (const name of names.filter((n) => /^timing-[0-9a-f-]{36}\.jsonl$/.test(n)).slice(-50)) {
    try { const result = await readTiming(env, name.slice(0, -6)); if (result.actor === 'student') sessions.push(result); } catch { /* An incomplete log remains unverified. */ }
  }
  return sessions.sort((a, b) => b.started_at - a.started_at);
}
export async function assessReadiness(env, { profileId = env.catalog.defaultProfileId, server } = {}) {
  const profile = env.catalog.profiles.get(profileId);
  if (!profile) throw new Error('Use a registered profile ID.');
  server ??= await inspectPort(env.config.server, env.service);
  const records = await recentReports(env), current = records.filter((r) => !r.stale).map((r) => r.report);
  const latest = (kind, condition = () => true) => current.find((r) => r.kind === kind && condition(r));
  const summary = (r) => r ? { status: r.status, report_id: r.report_id, checked_at: r.checked_at } : missing();
  const modelCheck = (kind) => {
    const r = latest(kind, (r) => r.model_profile_id === profileId);
    return { ...summary(r), ...(r ? { label: profile.metadata.is_mock ? 'mock simulation' : 'local endpoint check', metrics: r.result?.metrics } : {}) };
  };
  const probed = modelCheck('probe'), warmed = modelCheck('warm');
  const live = current.filter((r) => r.model_evidence === 'LIVE' && r.model_profile_id === profileId);
  const liveCases = Object.fromEntries([...SMOKE_CASES, ...REHEARSAL_CASES.filter((c) => c.kind !== 'blocked')].map((c) => {
    const report = live.find((r) => r.results.some((t) => t.id === c.id));
    if (!report) return [c.id, missing()];
    const trials = report.results.filter((r) => r.id === c.id); let streak = 0;
    for (const r of trials) streak = r.status === 'PASS' ? streak + 1 : 0;
    const status = trials.some((r) => r.status === 'FAIL') ? 'FAIL' : trials.some((r) => r.status === 'BLOCKED') ? 'BLOCKED'
      : streak >= 3 ? 'PASS' : trials.every((r) => r.status === 'NOT_RUN') ? 'NOT_RUN' : 'REVIEW_REQUIRED';
    return [c.id, { status, consecutive_passes: streak, report_id: report.report_id, trials: trials.map(({ trial, status, reason }) => ({ trial, status, reason })) }];
  }));
  const offline = Object.fromEntries(['smoke', 'rehearsal', 'verification'].map((kind) => [kind, summary(latest(kind, (r) => kind === 'verification' || r.model_evidence === 'SCRIPTED_BACKEND_ONLY'))]));
  const metrics = current.filter((r) => r.model_profile_id === profileId && (['probe', 'warm'].includes(r.kind) || r.model_evidence === 'LIVE'))
    .flatMap((r) => r.result?.metrics ? [r.result.metrics] : (r.results || []).map((t) => t.metrics).filter(Boolean));
  const sum = (fn) => metrics.reduce((total, m) => total + (fn(m) ?? 0), 0);
  const accounting = { scope: 'fresh saved checks for selected profile; excludes stale trials and reports of other profiles',
    provider_requests: sum((m) => m.provider_requests), model_calls: sum((m) => m.model_calls), repairs: sum((m) => m.repairs), retries: sum((m) => m.retries), model_ms: sum((m) => m.model_ms),
    metrics_records: metrics.length, provider_reported_tokens: metrics.some((m) => (m.tokens?.reported?.total ?? null) !== null) ? sum((m) => m.tokens?.reported?.total) : null,
    estimated_reservations: sum((m) => m.tokens?.estimated?.total), unavailable_usage_requests: sum((m) => m.tokens?.unavailable_requests) };
  const timings = await studentTiming(env), completedTiming = timings.find((t) => !t.stale && t.status === 'REVIEW_REQUIRED');
  const student = completedTiming ? { status: 'REVIEW_REQUIRED', timing_id: completedTiming.timing_id, total_ms: completedTiming.total_ms, note: completedTiming.student_adaptation.note }
    : { status: 'NOT_RUN', note: 'Chưa đo thời gian đổi đề thực tế. Use exam:timer and review the recorded student steps.' };
  const status = !profile.model || server.state !== 'running' || server.configuration_matches === false || Object.values(liveCases).some((r) => r.status === 'BLOCKED') ? 'BLOCKED'
    : Object.values(liveCases).some((r) => r.status === 'FAIL') ? 'FAIL' : 'REVIEW_REQUIRED';
  return { status, model_profile_id: profileId, server, model: { configured: !!profile.model, provider: profile.metadata.provider, name: profile.metadata.model,
    is_mock: profile.metadata.is_mock, identity: profile.identity, probed, warmed, connection_verified: !profile.metadata.is_mock && probed.status === 'PASS' },
    offline, live_cases: liveCases, accounting, student_adaptation: student, student_timings: timings.map(({ timing_id, status, stale, task_id, total_ms }) => ({ timing_id, status, stale, task_id, total_ms })),
    reports: records.map(({ report: r, stale, commit_changed }) => ({ report_id: r.report_id, kind: r.kind, status: r.status, stale, commit_changed,
      model_evidence: r.model_evidence, historical_failed_trials: r.results?.filter((t) => t.status === 'FAIL').length ?? 0 })),
    limitation: 'Most recent 50 reports. Three consecutive checked answers cover these cases only; broader semantics need manual reading. Stale evidence is excluded. Student timing is not inferred from scripts.' };
}
