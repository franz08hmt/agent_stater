import { open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadTaskConfig } from '../../config/task.config.js';
import { loadCatalog } from '../../config/catalog.config.js';
import { previewScaffold } from './planner.js';
import { digest, publishNew, rollbackFile, readBounded, safePath } from './files.js';
import { OFFLINE_CONFIG } from './spec.js';

export async function scaffoldProject({ root, spec, apply = false, register = false, hooks = {} }) {
  const plan = await previewScaffold({ root, spec, register });
  if (!apply) return plan;
  const created = []; let lock, temp, backup, published = false, uncertain = false;
  async function checkCatalog() {
    const current = await readBounded(root, 'config/catalog.json', 24576);
    if (digest(current.bytes) !== plan.catalog_hash || current.info.ino !== plan.catalog_ino || current.info.dev !== plan.catalog_dev) throw new Error('Catalog changed since preview; repeat preview with the current catalog.');
  }
  try {
    if (register) {
      lock = await publishNew(root, 'config/scaffold-register.lock', randomUUID());
      await checkCatalog();
    }
    for (const [index, file] of plan.files.entries()) {
      created.push(await publishNew(root, file.path, file.content));
      await hooks.afterFile?.(created.at(-1), index);
    }
    const task = await loadTaskConfig({ root, file: join(root, plan.catalog_entry.file) });
    if (task.fingerprint !== plan.task_fingerprint) throw new Error('Task/data changed during apply.');
    if (register) {
      await loadCatalog({ root, config: OFFLINE_CONFIG, virtualFiles: new Map([['config/catalog.json', plan.catalog_after]]), resolveCredentials: false });
      backup = `var/scaffold-backups/${randomUUID()}.catalog.json`;
      await publishNew(root, backup, plan.catalog_before, ['var']);
      const rel = `config/scaffold-${randomUUID()}.catalog.tmp`;
      temp = await safePath(root, rel, { newFile: true });
      const handle = await open(temp, 'wx');
      try { await handle.writeFile(plan.catalog_after); await handle.sync(); } finally { await handle.close(); }
      await hooks.beforeCatalogCheck?.();
      await checkCatalog();
      if (!await task.verifyCurrent()) throw new Error('Task/data changed before catalog publication.');
      // Cooperative lock serializes scaffold writers; same-directory rename publishes complete JSON.
      // External editors must stop editing catalog during apply (no portable filesystem CAS).
      try { await rename(temp, join(root, 'config/catalog.json')); published = true; }
      catch (error) {
        const current = await readBounded(root, 'config/catalog.json', 24576).catch(() => null);
        published = current && digest(current.bytes) === digest(plan.catalog_after);
        uncertain = !current;
        throw error;
      }
    }
    return { mode: 'applied', files: plan.files.map(({ path, kind }) => ({ path, kind })), tools: plan.tools, policy_ids: plan.policy_ids,
      catalog_entry: plan.catalog_entry, registered: published, backup, acceptance_status: 'NOT_RUN', task_fingerprint: plan.task_fingerprint };
  } catch (error) {
    const retained = [], removed = [];
    if (published || uncertain) retained.push(...created.map((f) => f.path));
    else for (const entry of created.toReversed()) (await rollbackFile(root, entry) ? removed : retained).push(entry.path);
    error.retained = retained; error.removed = removed; error.backup = backup;
    error.publication = published ? 'published' : uncertain ? 'unknown' : 'not_published';
    throw error;
  } finally {
    if (temp) await unlink(temp).catch(() => {});
    if (lock) await rollbackFile(root, lock);
  }
}
