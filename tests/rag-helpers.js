// Test-only fake Ollama. Its "embedding" is a deterministic hashed bag of words, which is
// enough to give lexically related texts nearby vectors in tests. It is NOT used by the product
// and proves nothing about a real embedding model.

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

export const DIMENSION = 48;
const IGNORED = new Set(['task', 'search', 'result', 'query', 'title', 'text', 'the', 'is', 'a', 'of', 'at', 'and', 'in', 'to', 'for', 'what', 'are', 'on', 'my', 'do', 'i']);

export function tokens(text) {
  return String(text).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !IGNORED.has(t));
}

export function fakeVector(text, dimension = DIMENSION) {
  const vector = new Array(dimension).fill(0.0001);
  for (const token of tokens(text)) {
    const h = createHash('sha256').update(token).digest();
    vector[h.readUInt16BE(0) % dimension] += 1;
    vector[h.readUInt16BE(2) % dimension] += 0.5; // a second bucket softens collisions
  }
  return vector;
}

/**
 * @param behavior {{dimension?:number, model?:string, models?:object[], fail?:(n:number)=>({status:number, body?:any}|null),
 *                   mutate?:(body:object, n:number)=>object, delayMs?:number|((n:number)=>number), omitUsage?:boolean}}
 */
export async function startFakeOllama(behavior = {}) {
  const hits = [];
  const dimension = behavior.dimension ?? DIMENSION;
  const model = behavior.model ?? 'embeddinggemma';
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    const body = raw ? JSON.parse(raw) : null;
    const record = { method: req.method, url: req.url, body };
    hits.push(record);
    const n = hits.filter((h) => h.url === '/api/embed').length;
    const send = (status, payload, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(typeof payload === 'string' ? payload : JSON.stringify(payload)); };
    if (req.method === 'GET' && req.url === '/api/tags') return send(200, { models: behavior.models ?? [{ name: `${model}:latest`, model: `${model}:latest`, digest: 'fakedigest0123456789', size: 622000000 }] });
    if (req.method === 'POST' && req.url === '/api/embed') {
      const delay = typeof behavior.delayMs === 'function' ? behavior.delayMs(n) : behavior.delayMs;
      if (delay) await new Promise((r) => setTimeout(r, delay));
      const failure = behavior.fail?.(n);
      if (failure) return send(failure.status, failure.body ?? { error: 'failed' }, failure.headers);
      const inputs = Array.isArray(body.input) ? body.input : [body.input];
      let payload = { model, embeddings: inputs.map((t) => fakeVector(t, dimension)), total_duration: 1, load_duration: 1, ...(behavior.omitUsage ? {} : { prompt_eval_count: inputs.reduce((s, t) => s + tokens(t).length, 0) }) };
      if (behavior.mutate) payload = behavior.mutate(payload, n);
      return send(200, payload);
    }
    return send(404, { error: 'not found' });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    hits, embedHits: () => hits.filter((h) => h.url === '/api/embed'),
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}

export const embeddingProfile = (baseUrl, over = {}) => ({
  id: 'fake-embed', name: 'embeddinggemma', baseUrl, timeoutMs: 2000, preprocessingVersion: 'embeddinggemma-v1',
  queryTemplate: 'task: search result | query: {text}', documentTemplate: 'title: {title} | text: {text}', ...over,
});

// ── Sunrise fixture: real catalog/task/index/runner/store, fake embedding HTTP, scripted LLM ──────────
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
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
