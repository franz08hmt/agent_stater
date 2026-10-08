import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { scaffoldFixture } from './scaffold-helpers.js';
import { scaffoldProject } from '../src/scaffold/apply.js';
import { loadCatalog } from '../config/catalog.config.js';
import { OFFLINE_CONFIG } from '../src/scaffold/spec.js';

test('apply/register preserves catalog defaults and old entries, saves original backup, and loads new task', async (t) => {
  const { root, spec } = await scaffoldFixture(t);
  const before = await readFile(join(root, 'config/catalog.json'), 'utf8');
  const result = await scaffoldProject({ root, spec, apply: true, register: true });
  assert.equal(result.mode, 'applied'); assert.equal(result.registered, true);
  assert.equal(await readFile(join(root, result.backup), 'utf8'), before);
  const raw = JSON.parse(await readFile(join(root, 'config/catalog.json'))), old = JSON.parse(before);
  assert.equal(raw.default_task_id, old.default_task_id); assert.equal(raw.default_model_profile_id, old.default_model_profile_id);
  assert.deepEqual(raw.tasks.slice(0, -1), old.tasks); assert.deepEqual(raw.model_profiles, old.model_profiles);
  const catalog = await loadCatalog({ root, config: OFFLINE_CONFIG, resolveCredentials: false });
  assert.equal(catalog.tasks.get(spec.task.id).task.datasets[0].idColumn, 'item_key');
  await assert.rejects(scaffoldProject({ root, spec, apply: true }), /already exists|exists in catalog/);
});
test('apply without register does not alter catalog; register flag in preview does not write', async (t) => {
  const { root, spec } = await scaffoldFixture(t), before = await readFile(join(root, 'config/catalog.json'));
  await scaffoldProject({ root, spec, register: true });
  await assert.rejects(access(join(root, `config/${spec.task.id}.task.json`)));
  const result = await scaffoldProject({ root, spec, apply: true });
  assert.equal(result.registered, false); assert.deepEqual(await readFile(join(root, 'config/catalog.json')), before);
});
test('failed apply rolls back only owned unchanged outputs; retains a student edit', async (t) => {
  const { root, spec } = await scaffoldFixture(t), before = await readFile(join(root, 'config/catalog.json'));
  let retained;
  await assert.rejects(scaffoldProject({ root, spec, apply: true, register: true, hooks: { async afterFile(entry, index) {
    if (index === 1) { retained = spec.assets[0].file; await writeFile(join(root, retained), 'student changed it'); throw new Error('Injected disk error'); }
  } } }), (error) => { assert.deepEqual(error.retained, [retained]); return /Injected disk error/.test(error.message); });
  assert.equal(await readFile(join(root, retained), 'utf8'), 'student changed it');
  await assert.rejects(access(join(root, `config/${spec.task.id}.task.json`)));
  assert.deepEqual(await readFile(join(root, 'config/catalog.json')), before);
});
test('catalog concurrent edit detected before atomic publication, preserving edit and removing new files', async (t) => {
  const { root, spec } = await scaffoldFixture(t); let edited;
  await assert.rejects(scaffoldProject({ root, spec, apply: true, register: true, hooks: { async beforeCatalogCheck() {
    const path = join(root, 'config/catalog.json'); edited = `${await readFile(path, 'utf8')}\n`; await writeFile(path, edited);
  } } }), /Catalog changed/);
  assert.equal(await readFile(join(root, 'config/catalog.json'), 'utf8'), edited);
  for (const file of [spec.assets[0].file, `config/${spec.task.id}.task.json`]) await assert.rejects(access(join(root, file)));
  assert.equal((await readdir(join(root, 'var/scaffold-backups'))).length, 1);
});
test('catalog full refuses registration rather than changing maximum or deleting tasks', async (t) => {
  const { root, spec } = await scaffoldFixture(t);
  for (let i = 0; i < 2; i++) { const next = structuredClone(spec); next.task.id = `extra-${i}`; next.assets = []; next.task.data.datasets[0].file = 'data/datasets/products.json';
    // Use validated existing task data instead of making acceptance unrelated to it.
    const original = JSON.parse(await readFile(join(root, 'config/task.json'))); next.template = 'notes'; next.task = { ...original, id: `extra-${i}`, allowed_tools: ['search_notes'] };
    const sample = (await scaffoldFixture(t, 'notes')).spec; next.cases = sample.cases.filter((c) => c.kind !== 'draft'); next.task.data.notes_dir = sample.task.data.notes_dir;
    next.assets = i ? [] : sample.assets;
    await scaffoldProject({ root, spec: next, apply: true, register: true });
  }
  await assert.rejects(scaffoldProject({ root, spec, apply: true, register: true }), /maxItems|at most|8/);
  await assert.rejects(access(join(root, spec.assets[0].file)));
});
