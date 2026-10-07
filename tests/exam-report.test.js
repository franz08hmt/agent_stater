import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvironment, configurationIdentity } from '../src/operations/context.js';
import { saveReport, readReport, sanitizeEvidence, reportFreshness, modelCheckStatus } from '../src/operations/reports.js';

test('model check distinguishes protocol failure from blocked connection and missing usage', () => {
  assert.equal(modelCheckStatus({ protocol_ok: false, error: { code: 'invalid_protocol' } }), 'FAIL');
  assert.equal(modelCheckStatus({ protocol_ok: false, error: { code: 'timeout' } }), 'BLOCKED');
  assert.equal(modelCheckStatus({ protocol_ok: false, error: { code: 'rate_limited' } }), 'BLOCKED');
  assert.equal(modelCheckStatus({ protocol_ok: true, metrics: { tokens: { reported: { total: null } } } }), 'PASS');
  assert.equal(modelCheckStatus({ status: 'BLOCKED', installed: false }), 'BLOCKED');
});

test('report sanitizer removes credentials, prompts and unnecessary internal paths', () => {
  const safe = sanitizeEvidence({ apiKey: 'private-key', messages: [{ content: 'system secret' }], root: 'D:/private',
    result: { authorization: 'Bearer private-key', answer: 'private-key at D:/private', status: 'FAIL' } }, { secrets: ['private-key'], root: 'D:/private' });
  assert.equal(JSON.stringify(safe).includes('private-key'), false);
  assert.equal(JSON.stringify(safe).includes('system secret'), false); assert.equal(JSON.stringify(safe).includes('D:/private'), false);
  assert.equal(safe.result.status, 'FAIL');
});
test('reports are append-only IDs, keep failures/NOT_RUN and become stale on config change', async (t) => {
  const env = await loadEnvironment({ dotenv: false }); env.root = await mkdtemp(join(tmpdir(), 'exam-report-'));
  t.after(() => rm(env.root, { recursive: true, force: true }));
  const report = await saveReport(env, 'smoke', { status: 'FAIL', results: [{ status: 'FAIL' }, { status: 'NOT_RUN' }] });
  assert.equal((await readReport(env, report.report_id)).stale, false);
  assert.equal(report.student_adaptation.status, 'NOT_RUN'); assert.equal(report.results.length, 2);
  const again = await saveReport(env, 'smoke', { status: 'FAIL' }); assert.notEqual(again.report_id, report.report_id);
  const old = env.service.configuration_id; env.config.limits.maxProviderRequests++;
  env.service.configuration_id = configurationIdentity(env.catalog, env.config);
  assert.notEqual(env.service.configuration_id, old); assert.equal(reportFreshness(report, env).stale, true);
  await assert.rejects(readReport(env, '../outside'));
  await assert.rejects(saveReport(env, 'smoke', { status: 'UNKNOWN' }));
});

test('task/data fingerprint, profile identity and smoke definitions invalidate old evidence', async () => {
  const env = await loadEnvironment({ dotenv: false });
  const initial = env.service.configuration_id;
  const task = env.catalog.tasks.get('rehearsal-tickets').task, original = task.fingerprint;
  task.fingerprint = 'changed-data-snapshot';
  assert.notEqual(configurationIdentity(env.catalog, env.config, env.evidenceContext.protocol_identity), initial);
  task.fingerprint = original;
  const profile = env.catalog.profiles.get('ollama-qwen3'); profile.identity = 'changed-model-endpoint';
  assert.notEqual(configurationIdentity(env.catalog, env.config, env.evidenceContext.protocol_identity), initial);
  const report = { context: { configuration_id: initial, suite_identity: 'old-grader', commit: env.evidenceContext.commit } };
  assert.equal(reportFreshness(report, env).stale, true);
});
