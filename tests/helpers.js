// Shared test harness: a runner wired to a scripted (or rule-based) mock model,
// the real sample notes (or in-memory docs) and a throwaway storage folder.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentRunner } from '../src/agent/runner.js';
import { createToolRegistry } from '../src/tools/registry.js';
import { createKeywordRetriever, createRetrieverFromDocs } from '../src/retrieval/keywordSearch.js';
import { createFileStore } from '../src/store/fileStore.js';
import { createScriptedModel } from '../src/model/mock.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const NOTES_DIR = join(ROOT, 'data', 'notes');

export const LIMITS = {
  maxSteps: 6,
  maxRepairs: 2,
  toolTimeoutMs: 2000,
  runMaxMs: 20000,
  maxGoalChars: 500,
  maxObservationChars: 1800,
  maxContextChars: 14000,
  maxAnswerChars: 2000,
  maxModelReplyChars: 8000,
};

/** Decision builders so tests read like the protocol. */
export const tool = (name, args) => JSON.stringify({ type: 'tool_call', tool: name, arguments: args });
export const final = (answer, source_ids = [], unresolved = '') => JSON.stringify({ type: 'final', answer, source_ids, unresolved });

export async function harness({ replies, model, limits = {}, docs, retriever, registry, modelTimeoutMs = 2000 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'agent-test-'));
  const store = await createFileStore({ root: dir });
  const r = retriever || (docs ? createRetrieverFromDocs(docs) : await createKeywordRetriever({ dir: NOTES_DIR }));
  const m = model || createScriptedModel(replies || []);
  const runner = createAgentRunner({
    model: m, registry: registry || createToolRegistry(), retriever: r, store,
    limits: { ...LIMITS, ...limits }, modelTimeoutMs,
  });
  await runner.init();
  return {
    runner, store, model: m, retriever: r, dir,
    /** Start a run and wait until it stops moving (completed, failed, stopped or awaiting approval). */
    async run(goal) {
      const started = await runner.startRun(goal);
      await runner.idle(started.run_id);
      return runner.getRun(started.run_id);
    },
    async settle(runId) {
      await runner.idle(runId);
      return runner.getRun(runId);
    },
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
