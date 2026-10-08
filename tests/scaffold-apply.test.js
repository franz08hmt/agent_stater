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
  const sample = (await scaffoldFixture(t, 'notes')).spec;
  for (let i = 0; i < 2; i++) {
    const next = structuredClone(sample); next.task.id = `extra-${i}`; next.task.allowed_tools = ['search_notes'];
    next.task.sample_inputs = [next.task.sample_inputs[0]];
    next.cases = next.cases.filter((c) => c.kind !== 'draft'); next.assets = i ? [] : next.assets;
    await scaffoldProject({ root, spec: next, apply: true, register: true });
  }
  await assert.rejects(scaffoldProject({ root, spec, apply: true, register: true }), /maxItems|at most|8/);
  await assert.rejects(access(join(root, spec.assets[0].file)));
});
test('simultaneous scaffold writers cannot publish over each other or remove another invocation lock', async (t) => {
  const { root, spec } = await scaffoldFixture(t), second = (await scaffoldFixture(t, 'notes')).spec;
  let unlock, entered; const gate = new Promise((r) => unlock = r), started = new Promise((r) => entered = r);
  const first = scaffoldProject({ root, spec, apply: true, register: true, hooks: { async afterFile(_entry, index) { if (!index) { entered(); await gate; } } } });
  await started;
  try { await assert.rejects(scaffoldProject({ root, spec: second, apply: true, register: true }), /already exists.*scaffold-register.lock/); }
  finally { unlock(); }
  await first;
  const raw = JSON.parse(await readFile(join(root, 'config/catalog.json')));
  assert.ok(raw.tasks.some((x) => x.id === spec.task.id)); assert.ok(!raw.tasks.some((x) => x.id === second.task.id));
  await assert.rejects(access(join(root, 'config/scaffold-register.lock')));
});
test('task data changed before register retains student edit and leaves catalog, .env and old var data untouched', async (t) => {
  const { root, spec } = await scaffoldFixture(t), before = await readFile(join(root, 'config/catalog.json'));
  const { mkdir } = await import('node:fs/promises'); await mkdir(join(root, 'var'));
  await writeFile(join(root, '.env'), 'sentinel secret'); await writeFile(join(root, 'var/keep.json'), 'existing run');
  await assert.rejects(scaffoldProject({ root, spec, apply: true, register: true, hooks: { async beforeCatalogCheck() {
    await writeFile(join(root, spec.assets[0].file), 'student new data');
  } } }), (e) => /Task\/data changed/.test(e.message) && e.retained.includes(spec.assets[0].file));
  assert.deepEqual(await readFile(join(root, 'config/catalog.json')), before);
  assert.equal(await readFile(join(root, '.env'), 'utf8'), 'sentinel secret');
  assert.equal(await readFile(join(root, 'var/keep.json'), 'utf8'), 'existing run');
});
