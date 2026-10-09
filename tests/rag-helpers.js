// Test-only helpers. The fake Ollama itself lives in eval/fake-ollama.js (it is also used by the offline harness).

import { startFakeOllama } from '../eval/fake-ollama.js';
export { DIMENSION, tokens, fakeVector, startFakeOllama } from '../eval/fake-ollama.js';

export const embeddingProfile = (baseUrl, over = {}) => ({
  id: 'fake-embed', name: 'embeddinggemma', baseUrl, timeoutMs: 2000, preprocessingVersion: 'embeddinggemma-v1',
  queryTemplate: 'task: search result | query: {text}', documentTemplate: 'title: {title} | text: {text}', ...over,
});

// ── Sunrise fixture: real catalog/task/index/runner/store, fake embedding HTTP, scripted LLM ──────────
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCatalog, buildCatalog } from '../config/catalog.config.js';
import { loadConfig } from '../config/agent.config.js';
import { createFileStore } from '../src/store/fileStore.js';
import { createRunManager } from '../src/agent/runManager.js';
import { createScriptedModel } from '../src/model/mock.js';
import { buildTaskIndex } from '../src/rag/indexBuilder.js';
import { publishIndex } from '../src/rag/vectorIndex.js';
import { createApp } from '../src/app.js';
import { ROOT } from './helpers.js';

export const SUNRISE = 'sunrise-clinic-rag';
export const EMBED_PROFILE = 'ollama-embeddinggemma';

/** A project copy whose embedding profile points at a fake Ollama. `indexed:false` leaves the index unbuilt. */
export async function sunriseProject(t, { ollama = {}, indexed = true, timeoutMs = 3000 } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'sunrise-project-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const folder of ['config', 'data']) await cp(join(ROOT, folder), join(root, folder), { recursive: true });
  const fake = await startFakeOllama(ollama);
  t.after(fake.close);
  const catalogFile = join(root, 'config', 'catalog.json');
  const raw = JSON.parse(await readFile(catalogFile, 'utf8'));
  raw.embedding_profiles[0].base_url = fake.baseUrl;
  raw.embedding_profiles[0].timeout_ms = timeoutMs;
  await writeFile(catalogFile, JSON.stringify(raw, null, 2));
  const config = loadConfig();
  const build = async () => {
    const catalog = await loadCatalog({ root, config });
    const entry = catalog.tasks.get(SUNRISE);
    const result = await buildTaskIndex({ task: entry.task, profile: catalog.embeddingProfiles.get(EMBED_PROFILE), createdAt: '2026-10-09T00:00:00.000Z' });
    await publishIndex(entry.task.retrieval.indexFile, result.doc);
    return result;
  };
  if (indexed) await build();
  return { root, fake, config, build, load: () => loadCatalog({ root, config }) };
}

/** Everything needed to run Sunrise goals end to end. */
export async function sunriseFixture(t, { replies = [], limits = {}, ...projectOptions } = {}) {
  const project = await sunriseProject(t, projectOptions);
  const base = await project.load();
  const task = base.tasks.get(SUNRISE).task;
  const model = createScriptedModel(replies);
  const catalog = await buildCatalog({ tasks: [task], profiles: [{ id: 'scripted', label: 'Scripted', config: { ...project.config.model, provider: 'mock' }, model }],
    embeddingProfiles: base.embeddingProfiles, defaultTaskId: SUNRISE, defaultProfileId: 'scripted' });
  const store = await createFileStore({ root: join(project.root, 'var') });
  const runLimits = { ...project.config.limits, ...limits };
  const manager = createRunManager({ catalog, store, limits: runLimits, modelTimeoutMs: 5000 });
  await manager.init();
  const ask = async (goal) => { const started = await manager.startRun(goal); await manager.idle(started.run_id); return manager.getRun(started.run_id); };
  const serve = async () => {
    const { server } = await createApp({ config: { ...project.config, limits: runLimits }, catalog, varDir: join(project.root, 'var'), publicDir: join(ROOT, 'public') });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    t.after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));
    return `http://127.0.0.1:${server.address().port}`;
  };
  return { ...project, catalog, base, task, model, store, manager, ask, serve, limits: runLimits };
}

export const call = (query) => JSON.stringify({ type: 'tool_call', tool: 'search_kb', arguments: { query } });
export const final = (answer, source_ids = [], unresolved = '') => JSON.stringify({ type: 'final', answer, source_ids, unresolved });
