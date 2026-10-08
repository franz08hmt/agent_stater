// Small filesystem boundary for the local CLI; no paths arrive from a model.
import { lstat, realpath, open, mkdir, link, unlink } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function safePath(root, file, { areas = ['config', 'data', 'tests', 'docs', 'templates'], newFile = false } = {}) {
  const parts = file.split('/');
  if (!areas.includes(parts[0]) || parts.length < 2 || parts.some((p) => !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(p)
    || p.endsWith('.') || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw new Error(`Unsafe path or Windows name: ${file}`);
  const base = resolve(root);
  if ((await lstat(base)).isSymbolicLink()) throw new Error('Project root must not be a link.');
  let path = base;
  for (const [i, part] of parts.entries()) {
    path = join(path, part);
    const info = await lstat(path).catch((err) => { if (err.code === 'ENOENT') return null; throw err; });
    if (!info) continue;
    if (info.isSymbolicLink() || await realpath(path) !== join(await realpath(base), ...parts.slice(0, i + 1))) throw new Error(`Linked path rejected: ${file}`);
    if (i < parts.length - 1 && !info.isDirectory()) throw new Error(`Parent is not a directory: ${file}`);
    if (i === parts.length - 1 && newFile) throw new Error(`Output already exists: ${file}`);
  }
  return path;
}
export async function readBounded(root, file, limit, areas) {
  const path = await safePath(root, file, { areas }), info = await lstat(path);
  if (!info.isFile() || info.size > limit) throw new Error(`File invalid or exceeds size limit: ${file}`);
  const handle = await open(path, 'r');
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino) throw new Error(`File changed while reading: ${file}`);
    const buffer = Buffer.alloc(limit + 1); let size = 0;
    while (size < buffer.length) { const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size); if (!bytesRead) break; size += bytesRead; }
    if (size > limit) throw new Error(`File exceeds size limit: ${file}`);
    return { bytes: buffer.subarray(0, size), info: opened, path };
  } finally { await handle.close(); }
}
export async function ensureParent(root, file, areas) {
  await safePath(root, file, { areas });
  let path = resolve(root);
  for (const part of file.split('/').slice(0, -1)) {
    path = join(path, part);
    await mkdir(path).catch((err) => { if (err.code !== 'EEXIST') throw err; });
    if (!(await lstat(path)).isDirectory() || (await lstat(path)).isSymbolicLink()) throw new Error('Parent must be a real directory.');
  }
  await safePath(root, file, { areas });
}
export async function publishNew(root, file, content, areas) {
  const path = await safePath(root, file, { areas, newFile: true });
  await ensureParent(root, file, areas);
  const bytes = Buffer.from(content), temp = join(dirname(path), `scaffold-${randomUUID()}.tmp`);
  const handle = await open(temp, 'wx');
  try {
    await handle.writeFile(bytes); await handle.sync(); const info = await handle.stat(); await handle.close();
    await safePath(root, file, { areas, newFile: true });
    await link(temp, path); // no overwrite and no partial JSON visible
    return { path: file, hash: digest(bytes), ino: info.ino, dev: info.dev };
  } finally { await handle.close().catch(() => {}); await unlink(temp).catch(() => {}); }
}
export async function rollbackFile(root, entry, areas) {
  try {
    const { bytes, info, path } = await readBounded(root, entry.path, 256 * 1024, areas);
    if (info.ino !== entry.ino || info.dev !== entry.dev || digest(bytes) !== entry.hash) return false;
    await unlink(path); return true;
  } catch { return false; }
}
