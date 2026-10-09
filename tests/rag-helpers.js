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
