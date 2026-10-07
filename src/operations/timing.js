import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sanitizeEvidence } from './reports.js';

export const TIMING_STEPS = ['read', 'map', 'config', 'start', 'acceptance', 'demo'];
function location(env, id) {
  if (!/^timing-[0-9a-f-]{36}$/.test(id)) throw new Error('Use a timing ID, not a path.');
  return join(env.root, 'var/exam/timings', `${id}.jsonl`);
}
export async function beginTiming(env, { taskId, actor = 'student', now = Date.now() }) {
  if (!env.catalog.tasks.has(taskId) || !['student', 'agent'].includes(actor) || !Number.isSafeInteger(now)) throw new Error('Use a registered task ID and student or agent actor.');
  const initial = { timing_id: `timing-${randomUUID()}`, task_id: taskId, actor, started_at: now, configuration_id: env.service.configuration_id };
  await mkdir(join(env.root, 'var/exam/timings'), { recursive: true });
  await writeFile(location(env, initial.timing_id), JSON.stringify(initial) + '\n', { flag: 'wx' });
  return initial;
}
export async function readTiming(env, id) {
  const [initial, ...events] = (await readFile(location(env, id), 'utf8')).trim().split('\n').map((v) => JSON.parse(v));
  const steps = TIMING_STEPS.map((step) => {
    const start = events.find((e) => e.step === step && e.event === 'start'), end = events.find((e) => e.step === step && e.event === 'end');
    return { step, started_at: start?.at ?? null, finished_at: end?.at ?? null, elapsed_ms: start && end ? end.at - start.at : null, note: end?.note ?? start?.note ?? '' };
  });
  const complete = steps.every((s) => s.finished_at !== null), status = complete ? 'REVIEW_REQUIRED' : 'NOT_RUN';
  return { ...initial, status, timing_kind: `${initial.actor}_self_recorded`, stale: (events.at(-1)?.configuration_id ?? initial.configuration_id) !== env.service.configuration_id,
    total_ms: complete ? steps.at(-1).finished_at - steps[0].started_at : null, steps,
    student_adaptation: { status: initial.actor === 'student' && complete ? 'REVIEW_REQUIRED' : 'NOT_RUN',
      note: initial.actor === 'student' && complete ? 'Self-recorded student time; inspect edits and errors before assessing readiness.' : 'Chưa đo thời gian đổi đề thực tế.' } };
}
export async function markTiming(env, id, { step, event, note = '', now = Date.now() }) {
  if (!TIMING_STEPS.includes(step) || !['start', 'end'].includes(event) || typeof note !== 'string' || note.length > 500 || !Number.isSafeInteger(now)) throw new Error('Invalid timing mark or note (maximum 500 characters).');
  const current = await readTiming(env, id), next = current.steps.find((s) => s.finished_at === null);
  if (!next) throw new Error('Timing session is finished.');
  if (next.step !== step || (next.started_at === null ? 'start' : 'end') !== event) throw new Error('Mark steps in order, start then end.');
  const last = current.steps.filter((s) => s.finished_at !== null).at(-1)?.finished_at ?? current.started_at;
  if (now < Math.max(last, next.started_at ?? 0)) throw new Error('Clock moved backwards; do not claim an elapsed time.');
  const safe = sanitizeEvidence({ step, event, at: now, note, configuration_id: env.service.configuration_id }, { root: env.root, secrets: [...env.catalog.profiles.values()].map((p) => p.config.apiKey).filter(Boolean) });
  // One CLI operator per session. The event log retains edits/errors rather than replacing them.
  await appendFile(location(env, id), JSON.stringify(safe) + '\n');
  return readTiming(env, id);
}
