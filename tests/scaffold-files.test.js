import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { safePath, readBounded, publishNew, rollbackFile } from '../src/scaffold/files.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'scaffold-files-'));
  t.after(async () => { assert.ok(root.startsWith(join(tmpdir(), 'scaffold-files-'))); await rm(root, { recursive: true, force: true }); });
  await mkdir(join(root, 'config')); return root;
}
test('scaffold file boundary rejects traversal, arbitrary areas and Windows reserved/ambiguous names', async (t) => {
  const root = await fixture(t);
  for (const file of ['../other.json', 'config/../other.json', 'D:/outside.json', '.env', 'var/runs/test.json', 'data/CON.json', 'data/Lpt1/note.md', 'data/a./x.json', 'data/a /x.json', 'data/x:stream.json', 'data\\x.json']) {
    await assert.rejects(safePath(root, file), /path|name|area/i, file);
  }
});
test('scaffold refuses linked parents, links at output and existing output without altering them', async (t) => {
  const root = await fixture(t); await mkdir(join(root, 'data'));
  await symlink(join(root, 'config'), join(root, 'data/linked'), 'junction');
  await assert.rejects(safePath(root, 'data/linked/x.json'), /link/);
  await writeFile(join(root, 'config/existing.json'), 'original');
  await assert.rejects(publishNew(root, 'config/existing.json', 'replacement'), /exists/);
  assert.equal(await readFile(join(root, 'config/existing.json'), 'utf8'), 'original');
});
test('atomic new file and rollback remove only an unchanged file owned by this invocation', async (t) => {
  const root = await fixture(t), entry = await publishNew(root, 'data/new/demo.json', 'new data');
  assert.equal(await readFile(join(root, entry.path), 'utf8'), 'new data');
  assert.equal(await rollbackFile(root, entry), true);
  const changed = await publishNew(root, 'data/new/demo.json', 'new data');
  await writeFile(join(root, changed.path), 'student edits');
  assert.equal(await rollbackFile(root, changed), false);
  assert.equal(await readFile(join(root, changed.path), 'utf8'), 'student edits');
  await assert.rejects(readBounded(root, changed.path, 3), /limit|large/);
});
