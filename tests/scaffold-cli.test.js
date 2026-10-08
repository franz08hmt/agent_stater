import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, readFile, writeFile, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT } from './helpers.js';
import { scaffoldFixture } from './scaffold-helpers.js';
import { parseScaffoldOptions } from '../src/scaffold/cli.js';

test('scaffold CLI rejects unknown, repeated or missing flags and never accepts arbitrary paths/endpoints', () => {
  for (const args of [[], ['--apply'], ['--spec=../.env'], ['--spec=C:/secret.json'], ['--spec=templates/con.json'],
    ['--spec=templates/a.json', '--endpoint=http://localhost'], ['--spec=templates/a.json', '--apply', '--apply']]) assert.throws(() => parseScaffoldOptions(args));
  assert.deepEqual(parseScaffoldOptions(['--spec=templates/notes.spec.json', '--register']), { specFile: 'templates/notes.spec.json', apply: false, register: true });
});
test('CLI root follows script location from unrelated cwd: preview -> apply/register -> acceptance, zero HTTP', async (t) => {
  const { root, spec } = await scaffoldFixture(t);
  for (const folder of ['src', 'eval', 'scripts', 'templates']) await cp(join(ROOT, folder), join(root, folder), { recursive: true });
  await cp(join(ROOT, 'package.json'), join(root, 'package.json'));
  const env = { ...process.env, MODEL_PROVIDER: 'openai-compatible', MODEL_API_KEY: 'DO_NOT_READ_OR_PRINT' }; delete env.NODE_TEST_CONTEXT;
  const call = async (file, args) => promisify(execFile)(process.execPath, [join(root, 'scripts', file), ...args], { cwd: tmpdir(), env });
  const before = await readFile(join(root, 'config/catalog.json'), 'utf8');
  const preview = await call('exam-scaffold.js', ['--spec=templates/dataset-read.spec.json', '--register']);
  const plan = JSON.parse(preview.stdout); assert.equal(plan.mode, 'preview'); assert.equal(plan.acceptance_status, 'NOT_RUN');
  assert.equal(await readFile(join(root, 'config/catalog.json'), 'utf8'), before);
  await assert.rejects(access(join(root, `config/${spec.task.id}.task.json`)));
  const applied = await call('exam-scaffold.js', ['--spec=templates/dataset-read.spec.json', '--apply', '--register']);
  assert.equal(JSON.parse(applied.stdout).registered, true);
  const checked = await call('exam-acceptance.js', [`--task=${spec.task.id}`]);
  assert.equal(JSON.parse(checked.stdout).status, 'PASS'); assert.equal(JSON.parse(checked.stdout).provider_requests, 0);
  for (const output of [preview.stdout, applied.stdout, checked.stdout]) { assert.ok(!output.includes(root)); assert.ok(!output.includes('DO_NOT_READ_OR_PRINT')); assert.ok(!output.includes('api_key_env')); }
  await writeFile(join(root, 'templates/large.spec.json'), 'x'.repeat(65537));
  await assert.rejects(call('exam-scaffold.js', ['--spec=templates/large.spec.json']), (e) => e.code === 2 && /limit/.test(e.stderr));
});
