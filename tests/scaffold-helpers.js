import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT } from './helpers.js';
export async function scaffoldFixture(t, template = 'dataset-read') {
  const root = await mkdtemp(join(tmpdir(), 'scaffold-project-'));
  t.after(async () => { assert.ok(root.startsWith(join(tmpdir(), 'scaffold-project-'))); await rm(root, { recursive: true, force: true }); });
  for (const folder of ['config', 'data']) await cp(join(ROOT, folder), join(root, folder), { recursive: true });
  const spec = JSON.parse(await readFile(join(ROOT, 'templates', `${template}.spec.json`), 'utf8'));
  return { root, spec };
}
