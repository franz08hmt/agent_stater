// Local persistence in plain JSON files under one root folder (default ./var).
// runs/<run_id>.json      current state of each run (rewritten atomically)
// drafts/<key>.json       one file per approved save_draft; the idempotency key is the file name
// logs/audit.jsonl        append-only record of every model call, tool call and approval
//
// Chosen over a database so the starter needs no installation; swap this module
// if the exam requires SQLite/PostgreSQL — the rest of the code only calls these functions.

import { mkdir, readFile, readdir, rename, writeFile, appendFile, open } from 'node:fs/promises';
import { join } from 'node:path';

const SAFE_KEY = /^[A-Za-z0-9_-]{1,80}$/;

export async function createFileStore({ root }) {
  const dirs = { runs: join(root, 'runs'), drafts: join(root, 'drafts'), logs: join(root, 'logs') };
  for (const d of Object.values(dirs)) await mkdir(d, { recursive: true });

  /** Write to a temp file then rename, so a crash never leaves half a JSON file. */
  async function writeJsonAtomic(file, data) {
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await rename(tmp, file);
  }

  return {
    root,

    async saveRun(run) {
      if (!SAFE_KEY.test(run.run_id)) throw new Error('Invalid run_id for storage.');
      await writeJsonAtomic(join(dirs.runs, `${run.run_id}.json`), run);
    },

    async loadRuns() {
      const out = [];
      for (const f of await readdir(dirs.runs)) {
        if (!f.endsWith('.json')) continue;
        try { out.push(JSON.parse(await readFile(join(dirs.runs, f), 'utf8'))); } catch { /* skip corrupt file */ }
      }
      return out;
    },

    /**
     * Create the draft only if no draft exists for this idempotency key.
     * The "wx" flag makes the operating system refuse a second create, so two
     * simultaneous approvals still produce exactly one file.
     * @returns {{ draft: object, created: boolean }}
     */
    async createDraftOnce(key, draft) {
      if (!SAFE_KEY.test(key)) throw new Error('Invalid idempotency key.');
      const file = join(dirs.drafts, `${key}.json`);
      try {
        const handle = await open(file, 'wx');
        try { await handle.writeFile(JSON.stringify(draft, null, 2), 'utf8'); } finally { await handle.close(); }
        return { draft, created: true };
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        return { draft: JSON.parse(await readFile(file, 'utf8')), created: false };
      }
    },

    async listDrafts() {
      const out = [];
      for (const f of await readdir(dirs.drafts)) {
        if (f.endsWith('.json')) out.push(JSON.parse(await readFile(join(dirs.drafts, f), 'utf8')));
      }
      return out.sort((a, b) => a.created_at.localeCompare(b.created_at));
    },

    async appendAudit(entry) {
      await appendFile(join(dirs.logs, 'audit.jsonl'), `${JSON.stringify(entry)}\n`, 'utf8');
    },
  };
}
