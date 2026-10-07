import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const STATUSES = ['PASS', 'FAIL', 'BLOCKED', 'REVIEW_REQUIRED', 'NOT_RUN'];
export function sanitizeEvidence(value, { secrets = [], root = '' } = {}) {
  if (typeof value === 'string') {
    for (const secret of [...secrets, root].filter(Boolean)) value = value.split(secret).join('[redacted]');
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => sanitizeEvidence(v, { secrets, root }));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([k]) => !/^(api.?key|authorization|headers|messages|system.?prompt|prompt|base.?url|endpoint|root|path|file)$/i.test(k))
    .map(([k, v]) => [k, sanitizeEvidence(v, { secrets, root })]));
  return value;
}
export async function saveReport(env, kind, details) {
  if (!/^[a-z-]+$/.test(kind)) throw new Error('Invalid report kind.');
  if (!STATUSES.includes(details.status) || details.results?.some((r) => !STATUSES.includes(r.status))) throw new Error('Use a documented evidence status.');
  const id = `${kind}-${randomUUID()}`;
  const report = sanitizeEvidence({ version: 1, report_id: id, checked_at: new Date().toISOString(), kind,
    context: env.evidenceContext, timing_kind: 'script_execution', student_adaptation: { status: 'NOT_RUN', note: 'Chưa đo thời gian đổi đề thực tế.' }, ...details },
    { root: env.root, secrets: [...env.catalog.profiles.values()].map((p) => p.config.apiKey).filter(Boolean) });
  await mkdir(join(env.root, 'var/exam'), { recursive: true });
  await writeFile(join(env.root, 'var/exam', `${id}.json`), JSON.stringify(report, null, 2), { flag: 'wx' });
  return report;
}
export function reportFreshness(report, env) {
  return { stale: report.context?.configuration_id !== env.service.configuration_id,
    commit_changed: report.context?.commit !== env.evidenceContext.commit };
}
export async function readReport(env, id) {
  if (!/^[a-z-]+-[0-9a-f-]{36}$/.test(id)) throw new Error('Use a registered report ID, not a file path.');
  const report = JSON.parse(await readFile(join(env.root, 'var/exam', `${id}.json`), 'utf8'));
  return { report, ...reportFreshness(report, env) };
}
