import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog, buildCatalog } from '../config/catalog.config.js';
import { loadConfig } from '../config/agent.config.js';
import { ROOT, TASK } from './helpers.js';
import { mkdtemp, mkdir, cp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('catalog loads validated notes/datasets, env and explicit mock without probing', async () => {
  const catalog = await loadCatalog({ root: ROOT, config: loadConfig() });
  const meta = catalog.metadata();
  assert.deepEqual(meta.tasks.map((t) => t.id), ['study-notes', 'datasets-demo']);
  assert.equal(meta.default_task_id, TASK.id); assert.equal(meta.default_model_profile_id, 'env');
  const tables = meta.tasks[1];
  assert.deepEqual(tables.tools.map((t) => t.name), ['query_dataset']);
  assert.equal(tables.data.datasets[0].row_count, 4);
  assert.ok(tables.data.datasets[0].version);
  assert.equal(meta.model_profiles.find((p) => p.id === 'mock').is_mock, true);
  const serialized = JSON.stringify(meta);
  for (const secret of ['apiKey', 'api_key_env', 'baseUrl', 'mission', 'dataDir', ROOT]) assert.ok(!serialized.includes(secret), secret);
});

test('missing required credentials leaves a profile unavailable without mock fallback', async () => {
  const catalog = await buildCatalog({ tasks: [TASK], profiles: [{ id: 'no-key', label: 'Missing credential', config: { ...loadConfig().model, provider: 'openai-compatible', apiKey: '' }, requiresKey: true }], defaultTaskId: TASK.id, defaultProfileId: 'no-key' });
  const profile = catalog.metadata().model_profiles[0];
  assert.equal(profile.status, 'unavailable'); assert.equal(profile.is_mock, false);
  assert.match(profile.reason, /credential/i); assert.equal(catalog.profiles.get('no-key').model, null);
});

test('profile identity changes on endpoint/profile/name/mock changes, excludes credentials', async () => {
  const config = { ...loadConfig().model, provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1/', apiKey: 'first-secret' };
  const make = async (id, over = {}) => (await buildCatalog({ tasks: [TASK], profiles: [{ id, label: 'Test', config: { ...config, ...over } }], defaultTaskId: TASK.id, defaultProfileId: id })).profiles.get(id).identity;
  const original = await make('test');
  assert.equal(await make('test', { apiKey: 'second-secret' }), original);
  assert.notEqual(await make('other'), original);
  assert.notEqual(await make('test', { baseUrl: 'http://127.0.0.1:9999/v1/' }), original);
  assert.notEqual(await make('test', { name: 'other' }), original);
  assert.notEqual(await make('test', { provider: 'mock' }), original);
});

test('catalog startup rejects paths, overrides, duplicate IDs and unknown defaults', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'agent-catalog-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(join(ROOT, 'data/notes'), join(root, 'data/notes'), { recursive: true });
  await mkdir(join(root, 'config')); await cp(join(ROOT, 'config/task.json'), join(root, 'config/task.json'));
  const raw = { default_task_id: TASK.id, default_model_profile_id: 'env', tasks: [{ id: TASK.id, file: 'config/task.json' }], model_profiles: [{ id: 'env', label: 'Environment', source: 'env' }] };
  const load = async (value) => { await writeFile(join(root, 'config/catalog.json'), JSON.stringify(value)); return loadCatalog({ root, config: loadConfig() }); };
  for (const file of ['../task.json', 'config/../task.json', 'D:/task.json', 'config/task.js', 'config/nested/task.json']) {
    await assert.rejects(load({ ...raw, tasks: [{ id: TASK.id, file }] }), /catalog/i);
  }
  await assert.rejects(load({ ...raw, model_profiles: [{ ...raw.model_profiles[0], base_url: 'http://override/' }] }), /override/i);
  await assert.rejects(load({ ...raw, model_profiles: [{ id: 'env', label: 'Bad', provider: 'mock', api_key: 'inline' }] }), /catalog/i);
  await assert.rejects(load({ ...raw, tasks: [...raw.tasks, ...raw.tasks] }), /unique/i);
  await assert.rejects(load({ ...raw, model_profiles: [...raw.model_profiles, ...raw.model_profiles] }), /unique/i);
  await assert.rejects(load({ ...raw, default_task_id: 'missing' }), /defaults/i);
  await assert.rejects(load({ ...raw, tasks: [{ id: 'different', file: 'config/task.json' }] }), /match/i);
  await load(raw);
  await writeFile(join(root, 'config/catalog.json'), ' '.repeat(25000));
  await assert.rejects(loadCatalog({ root, config: loadConfig() }), /24 KiB/i);
});

test('catalog rejects a linked config directory', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'agent-catalog-link-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'actual')); await symlink(join(root, 'actual'), join(root, 'config'), 'junction');
  await assert.rejects(loadCatalog({ root, config: loadConfig() }), /symlink/i);
});
