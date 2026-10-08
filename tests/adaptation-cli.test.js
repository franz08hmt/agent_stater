import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT } from './helpers.js';

const exec = promisify(execFile);
async function cleanProject(t) {
  const root = await mkdtemp(join(tmpdir(), 'adaptation-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const folder of ['src', 'config', 'data', 'scripts', 'templates', 'eval']) await cp(join(ROOT, folder), join(root, folder), { recursive: true });
  await cp(join(ROOT, 'package.json'), join(root, 'package.json'));
  return root;
}
async function run(root) {
  try { return { code: 0, ...await exec(process.execPath, ['scripts/verify-adaptation.js'], { cwd: root, timeout: 20000 }) }; }
  catch (error) { return { code: error.code, stdout: error.stdout, stderr: error.stderr }; }
}
const artifactRoot = (root) => join(root, 'var/adaptation-kit-20261008');
async function report(root) {
  const entries = await readdir(artifactRoot(root));
  assert.equal(entries.length, 1);
  return JSON.parse(await readFile(join(artifactRoot(root), entries[0], 'report.json'), 'utf8'));
}

test('adaptation CLI runs on source without var and appends separate UUID artifacts', async (t) => {
  const root = await cleanProject(t);
  await assert.rejects(readdir(join(root, 'var')), { code: 'ENOENT' });
  const first = await run(root);
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /Verdict: PASS/);
  const initial = await report(root);
  assert.equal(initial.status, 'PASS'); assert.equal(initial.session.used, 0);
  const entries = await readdir(artifactRoot(root));
  const bytes = await readFile(join(artifactRoot(root), entries[0], 'report.json'), 'utf8');
  const second = await run(root); assert.equal(second.code, 0, second.stderr);
  assert.equal((await readdir(artifactRoot(root))).length, 2);
  assert.equal(await readFile(join(artifactRoot(root), entries[0], 'report.json'), 'utf8'), bytes);
});

test('wrong independent expected is FAIL, nonzero exit and preserved acceptance evidence', async (t) => {
  const root = await cleanProject(t);
  await mkdir(artifactRoot(root), { recursive: true }); // Isolate verdict from missing-parent regression.
  const file = join(root, 'templates/asset-loan.spec.json'), spec = JSON.parse(await readFile(file, 'utf8'));
  spec.cases.find((c) => c.id === 'available').expected.available = '12';
  await writeFile(file, JSON.stringify(spec));
  const result = await run(root);
  assert.equal(result.code, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /Verdict: FAIL/);
  const actual = await report(root);
  assert.equal(actual.status, 'FAIL'); assert.equal(actual.session.used, 0);
  assert.ok(actual.results.some((r) => r.status === 'FAIL'));
  const [directory] = await readdir(artifactRoot(root));
  const offline = JSON.parse(await readFile(join(artifactRoot(root), directory, 'offline.json'), 'utf8'));
  assert.equal(offline.status, 'FAIL');
});

test('missing scaffold prerequisites remain BLOCKED with nonzero exit and zero model requests', async (t) => {
  const root = await cleanProject(t);
  const file = join(root, 'templates/asset-loan.spec.json'), spec = JSON.parse(await readFile(file, 'utf8'));
  spec.task.id = 'study-notes'; // Already registered; preparation cannot proceed.
  await writeFile(file, JSON.stringify(spec));
  const result = await run(root);
  assert.equal(result.code, 2, result.stdout + result.stderr);
  assert.match(result.stdout, /Verdict: BLOCKED/);
  const actual = await report(root);
  assert.equal(actual.status, 'BLOCKED'); assert.equal(actual.session.used, 0);
});
