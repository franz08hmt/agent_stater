import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './helpers.js';
import { loadTaskConfig } from '../config/task.config.js';
import { loadCatalog } from '../config/catalog.config.js';

test('task preview validates virtual notes/data/config without creating files and fingerprints the exact bytes', async () => {
  const raw = JSON.parse(await readFile(join(ROOT, 'config/proposal-tickets.task.json'), 'utf8'));
  raw.id = 'overlay-preview'; raw.data.notes_dir = 'data/overlay-preview';
  raw.data.datasets[0].file = 'data/overlay-preview/tickets.json';
  const files = new Map([
    ['config/overlay-preview.task.json', JSON.stringify(raw)],
    ['data/overlay-preview/background.md', '# Fictional background\n\nThis is a simulation.\n'],
    ['data/overlay-preview/tickets.json', await readFile(join(ROOT, 'data/datasets/tickets.json'), 'utf8')],
  ]);
  const task = await loadTaskConfig({ root: ROOT, file: join(ROOT, 'config/overlay-preview.task.json'), virtualFiles: files });
  assert.equal(task.datasets[0].rows.length, 6); assert.equal(task.proposalPolicies.length, 1);
  const first = task.fingerprint;
  files.set('data/overlay-preview/background.md', '# Other background\n\nDifferent simulation.\n');
  assert.notEqual((await loadTaskConfig({ root: ROOT, file: join(ROOT, 'config/overlay-preview.task.json'), virtualFiles: files })).fingerprint, first);
  files.set('data/overlay-preview/tickets.json', '[{}]');
  await assert.rejects(loadTaskConfig({ root: ROOT, file: join(ROOT, 'config/overlay-preview.task.json'), virtualFiles: files }), /columns/);
  for (const file of files.keys()) await assert.rejects(access(join(ROOT, file)), { code: 'ENOENT' });
});

test('prospective catalog validation can avoid credentials and network entirely', async () => {
  const raw = JSON.parse(await readFile(join(ROOT, 'config/catalog.json'), 'utf8'));
  raw.model_profiles.push({ id: 'scaffold-unavailable', label: 'No credentials resolved', provider: 'openai-compatible',
    name: 'fictional', base_url: 'https://example.invalid/v1/', requires_key: true, api_key_env: 'SCAFFOLD_PRIVATE_KEY' });
  const original = process.env; let secretReads = 0;
  process.env = new Proxy(original, { get(target, key) { if (key === 'SCAFFOLD_PRIVATE_KEY') { secretReads++; throw new Error('Must not read a credential'); } return target[key]; } });
  try {
    const catalog = await loadCatalog({ root: ROOT, config: { model: { provider: 'mock', name: 'mock' } },
      virtualFiles: new Map([['config/catalog.json', JSON.stringify(raw)]]), resolveCredentials: false });
    assert.equal(catalog.profiles.get('scaffold-unavailable').metadata.status, 'unavailable');
    assert.equal(secretReads, 0);
  } finally { process.env = original; }
});
