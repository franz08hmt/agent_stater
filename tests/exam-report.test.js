import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvironment, configurationIdentity, PROJECT_ROOT } from '../src/operations/context.js';
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

async function copiedProject(t) {
  const root = await mkdtemp(join(tmpdir(), 'exam-fingerprint-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all(['src', 'config', 'data', 'eval', 'package.json'].map((file) => cp(join(PROJECT_ROOT, file), join(root, file), { recursive: true })));
  return root;
}
test('runtime changes to budgeting, grounding, schema, data loading and run management stale saved evidence', async (t) => {
  const root = await copiedProject(t), original = await loadEnvironment({ root, dotenv: false });
  const report = await saveReport(original, 'smoke', { status: 'PASS' });
  for (const file of ['src/agent/metrics.js', 'src/agent/decision.js', 'src/agent/state.js', 'src/tools/schema.js',
    'src/tools/registry.js', 'src/tools/saveDraft.js', 'src/data/datasets.js', 'src/agent/runManager.js', 'src/store/fileStore.js']) {
    const path = join(root, file), code = await readFile(path, 'utf8');
    await writeFile(path, file.endsWith('metrics.js') ? code.replace('+ 128 +', '+ 256 +') : code + '\nexport const regressionRuntimeRevision = 2;\n');
    const changed = await loadEnvironment({ root, dotenv: false });
    assert.equal((await readReport(changed, report.report_id)).stale, true, file);
    await writeFile(path, code);
  }
  assert.equal((await readReport(await loadEnvironment({ root, dotenv: false }), report.report_id)).stale, false);
});
test('a dependency grader logic change makes readiness evidence stale', async (t) => {
  const root = await copiedProject(t), env = await loadEnvironment({ root, dotenv: false });
  const report = await saveReport(env, 'rehearsal', { status: 'PASS' });
  const path = join(root, 'eval/checks.js'), code = await readFile(path, 'utf8');
  await writeFile(path, code.replace("tool.access !== 'read'", "tool.access === 'write'"));
  const updated = await loadEnvironment({ root, dotenv: false });
  assert.notEqual(updated.evidenceContext.suite_identity, env.evidenceContext.suite_identity);
  assert.equal((await readReport(updated, report.report_id)).stale, true);
});

test('an actual documentation-only commit changes commit metadata but keeps runtime evidence fresh', async (t) => {
  const root = await copiedProject(t);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd: root, stdio: 'ignore' });
  git('init'); git('add', 'src', 'config', 'data', 'eval', 'package.json'); git('commit', '-m', 'Fixture runtime');
  const env = await loadEnvironment({ root, dotenv: false }), report = await saveReport(env, 'smoke', { status: 'PASS' });
  await mkdir(join(root, 'docs')); await writeFile(join(root, 'docs', 'knowledge.md'), '# Documentation only\n');
  git('add', 'docs/knowledge.md'); git('commit', '-m', 'Fixture documentation');
  const updated = await loadEnvironment({ root, dotenv: false }), read = await readReport(updated, report.report_id);
  assert.notEqual(updated.evidenceContext.commit, env.evidenceContext.commit);
  assert.equal(read.commit_changed, true); assert.equal(read.stale, false);
});
