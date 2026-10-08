// Local persistence in plain JSON files under one root folder (default ./var).
// runs/<run_id>.json      current state of each run (rewritten atomically)
// drafts/<key>.json       one file per approved save_draft; the idempotency key is the file name
// proposals/<key>.json    internal proposals, atomically published once per approval
// logs/audit.jsonl        append-only record of every model call, tool call and approval
//
// Chosen over a database so the starter needs no installation; swap this module
// if the exam requires SQLite/PostgreSQL — the rest of the code only calls these functions.

import { mkdir, readFile, readdir, rename, writeFile, appendFile, open, link, unlink, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const SAFE_KEY = /^[A-Za-z0-9_-]{1,80}$/;

export async function createFileStore({ root }) {
  const dirs = { runs: join(root, 'runs'), drafts: join(root, 'drafts'), proposals: join(root, 'proposals'), logs: join(root, 'logs'), followups: join(root, 'followups') };
  for (const d of Object.values(dirs)) await mkdir(d, { recursive: true });

  /** Write to a temp file then rename, so a crash never leaves half a JSON file. */
  async function writeJsonAtomic(file, data) {
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await rename(tmp, file);
  }

  async function getProposal(key) {
    if (!SAFE_KEY.test(key)) throw new Error('Invalid proposal key.');
    const file = join(dirs.proposals, `${key}.json`);
    let info;
    try { info = await lstat(file); } catch (err) { if (err.code === 'ENOENT') return null; throw new Error('Proposal storage unavailable.'); }
    if (!info.isFile() || info.size > 16384) throw new Error('Invalid proposal storage record.');
    let handle;
    try { handle = await open(file, 'r'); } catch { throw new Error('Proposal storage unavailable.'); }
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.ino !== info.ino || opened.dev !== info.dev) throw new Error('Proposal file changed while reading.');
      const buffer = Buffer.alloc(16385); let size = 0;
      while (size < buffer.length) {
        const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size); if (!bytesRead) break; size += bytesRead;
      }
      if (size > 16384) throw new Error('Proposal record exceeds size limit.');
      return JSON.parse(buffer.subarray(0, size).toString('utf8'));
    } catch { throw new Error('Proposal storage unavailable or invalid.'); }
    finally { await handle.close(); }
  }

  return {
    root,
    getProposal,
    async saveFollowups(ledger) {
      if (!SAFE_KEY.test(ledger.run_id) || ledger.results.length > 3 || Buffer.byteLength(JSON.stringify(ledger)) > 65536) throw new Error('Invalid follow-up ledger.');
      await writeJsonAtomic(join(dirs.followups, `${ledger.run_id}.json`), ledger);
    },
    async getFollowups(id) {
      if (!SAFE_KEY.test(id)) throw new Error('Invalid follow-up run ID.');
      try {
        const file = join(dirs.followups, `${id}.json`), info = await lstat(file);
        if (!info.isFile() || info.size > 65536) throw new Error('Invalid follow-up storage.');
        return JSON.parse(await readFile(file, 'utf8'));
      } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async listFollowups() {
      const out = [];
      for (const name of await readdir(dirs.followups)) if (name.endsWith('.json') && SAFE_KEY.test(name.slice(0, -5))) out.push(await this.getFollowups(name.slice(0, -5)));
      return out;
    },

    async createProposalOnce(key, proposal, { signal } = {}) {
      if (!SAFE_KEY.test(key) || proposal.proposal_id !== key || JSON.stringify(proposal).length > 16384) throw Object.assign(new Error('Invalid proposal storage record.'), { writeOutcome: 'not_saved' });
      const file = join(dirs.proposals, `${key}.json`), temp = join(dirs.proposals, `${key}.${randomUUID()}.tmp`);
      let publishing = false;
      try {
        signal?.throwIfAborted();
        const handle = await open(temp, 'wx');
        try { await handle.writeFile(JSON.stringify(proposal, null, 2), 'utf8'); await handle.sync(); } finally { await handle.close(); }
        signal?.throwIfAborted(); // a timed out pre-publication write must not publish later
        publishing = true;
        try { await link(temp, file); return { proposal, created: true }; }
        catch (err) {
          if (err.code !== 'EEXIST') throw err;
          const existing = await getProposal(key);
          if (!existing || existing.args_hash !== proposal.args_hash || existing.run_id !== proposal.run_id || existing.task_fingerprint !== proposal.task_fingerprint) throw new Error('Proposal idempotency key collision.');
          return { proposal: existing, created: false };
        }
      } catch (err) {
        let writeOutcome = 'not_saved';
        if (publishing) { try { writeOutcome = await getProposal(key) ? 'unknown' : 'not_saved'; } catch { writeOutcome = 'unknown'; } }
        throw Object.assign(new Error(err.message.includes('collision') ? err.message : 'Proposal storage failed; check the saved proposal list.'), { writeOutcome });
      } finally { await unlink(temp).catch(() => {}); }
    },

    async listProposals(limit = 20) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Proposal list limit must be 1..50.');
      const names = (await readdir(dirs.proposals)).filter((n) => n.endsWith('.json') && SAFE_KEY.test(n.slice(0, -5)));
      const proposals = [];
      const files = await Promise.all(names.map(async (name) => ({ name, modified: (await lstat(join(dirs.proposals, name))).mtimeMs })));
      for (const { name } of files.sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name)).slice(0, limit)) {
        const proposal = await getProposal(name.slice(0, -5)); if (proposal) proposals.push(proposal);
      }
      return proposals.sort((a, b) => b.created_at.localeCompare(a.created_at));
    },

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
