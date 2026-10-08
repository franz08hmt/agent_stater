import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT } from './helpers.js';
import { scaffoldFixture } from './scaffold-helpers.js';
import { previewScaffold } from '../src/scaffold/planner.js';

async function tree(root, prefix = '') {
  const result = [];
  for (const d of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${d.name}` : d.name;
    if (d.isDirectory()) result.push(...await tree(root, path)); else result.push([path, await readFile(join(root, path), 'utf8')]);
  }
  return result;
}
for (const template of ['notes', 'dataset-read', 'proposal']) test(`preview ${template} validates all planned files without writes, execution or additional permissions`, async (t) => {
  const { root, spec } = await scaffoldFixture(t, template), before = await tree(root);
  const plan = await previewScaffold({ root, spec, register: true });
  assert.deepEqual(await tree(root), before); assert.equal(plan.mode, 'preview'); assert.equal(plan.acceptance_status, 'NOT_RUN');
  assert.deepEqual(plan.tools, spec.task.allowed_tools); assert.ok(plan.files.some((f) => f.path === `tests/${spec.task.id}.generated.test.js`));
  assert.ok(plan.files.some((f) => f.path === `config/${spec.task.id}.task.json`));
  assert.ok(plan.files.some((f) => f.path === `tests/${spec.task.id}.acceptance.json`));
});
for (const [name, mutate] of [
  ['unknown spec field', (s) => s.endpoint = 'https://example.invalid'], ['version', (s) => s.version = 2],
  ['placeholder', (s) => s.task.mission = 'TODO fill in the actual mission'], ['duplicate ID', (s) => s.task.id = 'study-notes'],
  ['unexpected tool', (s) => s.task.allowed_tools.push('save_draft')], ['unsupported policy', (s) => s.task.proposal_policies = [{policy_id:'new-policy',datasets:{subject:'inventory'}}]],
  ['invalid ID column', (s) => s.task.data.datasets[0].id_column = 'missing'], ['bad numeric scale', (s) => s.task.data.datasets[0].columns[2].scale = 0],
  ['missing expected', (s) => delete s.cases[0].expected], ['missing failure case', (s) => s.cases = s.cases.filter((c) => c.kind !== 'blocked')],
  ['traversal', (s) => s.assets[0].file = 'data/../existing.json'], ['Windows name', (s) => s.task.id = 'con'],
]) test(`scaffold refuses ${name} before writing`, async (t) => {
  const { root, spec } = await scaffoldFixture(t); mutate(spec);
  await assert.rejects(previewScaffold({ root, spec }));
});
