import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTaskConfig, validateTaskConfig } from '../config/task.config.js';
import { ROOT, TASK } from './helpers.js';

const dataset = { id: 'items', file: 'data/items.json', id_column: 'id', columns: [{ name: 'id', type: 'string' }, { name: 'amount', type: 'number', scale: 2 }] };
const rawTask = {
  id: 'table-demo', title: 'Table demo', mission: 'Answer only from query_dataset evidence; cite source IDs and explain any missing data.',
  data: { notes_dir: 'data/notes', datasets: [dataset] }, allowed_tools: ['query_dataset'],
  sample_inputs: [{ label: 'Total', goal: 'Sum amount for all items.' }],
  result_labels: { answer: 'Answer', sources: 'Sources', unresolved: 'Missing' },
};
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'dataset-task-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'data/notes'), { recursive: true });
  await mkdir(join(root, 'config'));
  await writeFile(join(root, 'data/notes/test.md'), '# Test\n\nExample.');
  await writeFile(join(root, 'data/items.json'), '[{"id":"a","amount":"0.10"}]');
  return root;
}

test('existing notes task needs no dataset configuration', async () => {
  const task = await loadTaskConfig({ root: ROOT });
  assert.deepEqual(task.allowedTools, TASK.allowedTools);
  assert.deepEqual(task.datasets, []);
});

test('startup validates table task and fingerprints actual dataset content', async (t) => {
  const root = await setup(t);
  await writeFile(join(root, 'config/task.json'), JSON.stringify(rawTask));
  const first = await loadTaskConfig({ root });
  assert.equal(first.datasets[0].rows[0].amount, '0.10');
  await writeFile(join(root, 'data/items.json'), '[{"id":"a","amount":"0.20"}]');
  const second = await loadTaskConfig({ root });
  assert.notEqual(first.fingerprint, second.fingerprint);
});

test('startup refuses enabled query tool with no datasets and invalid datasets even when disabled', async (t) => {
  const root = await setup(t);
  await assert.rejects(validateTaskConfig({ ...rawTask, data: { notes_dir: 'data/notes' } }, root), /query_dataset.*dataset/i);
  await assert.rejects(validateTaskConfig({ ...rawTask, data: { notes_dir: 'data/notes', datasets: [] } }, root), /query_dataset.*dataset/i);
  for (const file of ['../items.json', 'data/../items.json', 'data/missing.json']) {
    await assert.rejects(validateTaskConfig({ ...rawTask, allowed_tools: ['search_notes'], data: { ...rawTask.data, datasets: [{ ...dataset, file }] } }, root), /dataset/i);
  }
  await writeFile(join(root, 'data/items.json'), '[{"id":"a","amount":""}]');
  await assert.rejects(validateTaskConfig(rawTask, root), /amount/i);
});

test('sample demo task loads two domains without enabling tools in the default notes task', async () => {
  const demo = await loadTaskConfig({ root: ROOT, file: join(ROOT, 'config/datasets-demo.task.json') });
  assert.deepEqual(demo.datasets.map((d) => d.id), ['products', 'classes']);
  assert.deepEqual(demo.allowedTools, ['query_dataset']);
  assert.equal(TASK.allowedTools.includes('query_dataset'), false);
});

test('configured dataset symlink fails task startup', async (t) => {
  const root = await setup(t);
  await symlink(join(root, 'data'), join(root, 'data/link'), 'junction');
  await assert.rejects(validateTaskConfig({ ...rawTask, data: { ...rawTask.data, datasets: [{ ...dataset, file: 'data/link/items.json' }] } }, root), /symlink|link/i);
});
