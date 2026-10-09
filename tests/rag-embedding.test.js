import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOllamaEmbedder, EmbeddingError, validatePromptEvalCount, assertVector, applyTemplate, MAX_BATCH } from '../src/rag/embedding.js';
import { startFakeOllama, embeddingProfile, DIMENSION } from './rag-helpers.js';

const make = async (t, behavior, profile = {}) => {
  const fake = await startFakeOllama(behavior);
  t.after(fake.close);
  return { fake, embedder: createOllamaEmbedder(embeddingProfile(fake.baseUrl, profile)) };
};

test('request shape: native /api/embed, truncate:false, batch as array, single as string', async (t) => {
  const { fake, embedder } = await make(t, {}, { keepAlive: '30m', dimensions: DIMENSION });
  await embedder.embed(['alpha text', 'beta text']);
  await embedder.embed(['gamma text']);
  const [batch, single] = fake.embedHits();
  assert.equal(batch.url, '/api/embed');
  assert.equal(batch.body.model, 'embeddinggemma');
  assert.deepEqual(batch.body.input, ['alpha text', 'beta text']);
  assert.equal(batch.body.truncate, false, 'never silently drop text that exceeds the context window');
  assert.equal(batch.body.keep_alive, '30m');
  assert.equal(batch.body.dimensions, DIMENSION);
  assert.equal(single.body.input, 'gamma text');
});

test('query and document prompts follow the configured templates', async (t) => {
  const { embedder } = await make(t, {});
  assert.equal(embedder.queryText('current dermatology fee?'), 'task: search result | query: current dermatology fee?');
  assert.equal(embedder.documentText({ title: 'Sunrise — 4. Fees', text: 'A | B' }), 'title: Sunrise — 4. Fees | text: A | B');
  assert.equal(applyTemplate('{text}{text}', { text: 'x' }), 'xx');
  assert.equal(applyTemplate('${process.exit()} {text}', { text: 'ok' }), '${process.exit()} ok', 'templates are plain substitution, never code');
});

test('a valid response returns real vectors, usage and the model identity', async (t) => {
  const { embedder } = await make(t, {});
  const out = await embedder.embed(['dermatology fee', 'opening hours']);
  assert.equal(out.vectors.length, 2);
  assert.equal(out.dimension, DIMENSION);
  assert.equal(out.model, 'embeddinggemma');
  assert.deepEqual(out.usage, { input_tokens: 4, present: true, valid: true });
});

test('usage: missing or invalid prompt_eval_count stays unavailable, never zero', async (t) => {
  assert.deepEqual(validatePromptEvalCount(undefined), { input_tokens: null, present: false, valid: false });
  for (const bad of [-1, 1.5, '3', NaN, Infinity, 2 ** 60]) assert.deepEqual(validatePromptEvalCount(bad), { input_tokens: null, present: true, valid: false }, String(bad));
  assert.deepEqual(validatePromptEvalCount(0), { input_tokens: 0, present: true, valid: true });
  const { embedder } = await make(t, { omitUsage: true });
  const out = await embedder.embed(['x text']);
  assert.equal(out.usage.input_tokens, null);
  assert.equal(out.usage.present, false);
});

const vectorsOf = (n, make2) => Array.from({ length: n }, (_, i) => make2(i));
const good = (i = 0) => Array.from({ length: 16 }, (_, k) => (k === i ? 1 : 0.1));

test('malformed responses are rejected: shape, count, dimension, non-finite, zero vector, wrong model', async (t) => {
  const cases = {
    'no embeddings array': () => ({ model: 'embeddinggemma' }),
    'wrong count': () => ({ model: 'embeddinggemma', embeddings: [good()] }),
    'mixed dimensions': () => ({ model: 'embeddinggemma', embeddings: [good(), good().slice(0, 12)] }),
    'too few dimensions': () => ({ model: 'embeddinggemma', embeddings: vectorsOf(2, () => [1, 2, 3]) }),
    'null element': () => ({ model: 'embeddinggemma', embeddings: [good(), good().map((v, i) => (i === 3 ? null : v))] }),
    'string element': () => ({ model: 'embeddinggemma', embeddings: [good(), good().map((v, i) => (i === 3 ? '0.5' : v))] }),
    'zero vector': () => ({ model: 'embeddinggemma', embeddings: [good(), new Array(16).fill(0)] }),
    'other model answered': () => ({ model: 'qwen3:8b', embeddings: [good(), good(1)] }),
    'not JSON object': () => '[1,2,3]',
    'infinity': () => '{"model":"embeddinggemma","embeddings":[[1e999,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1,0.1],[1,2,3,4,5,6,7,8,9,10]]}',
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const { embedder } = await make(t, { mutate });
    await assert.rejects(embedder.embed(['one', 'two']), (err) => err instanceof EmbeddingError && err.kind === 'bad_response', name);
  }
});

test('assertVector: dimension and finiteness are enforced for stored index vectors too', () => {
  assert.doesNotThrow(() => assertVector(good(), 16));
  assert.throws(() => assertVector(good(), 15), /dimension/);
  assert.throws(() => assertVector([...good().slice(1), NaN], 16), /non-finite/);
  assert.throws(() => assertVector(new Array(16).fill(0), 16), /zero norm/);
  assert.throws(() => assertVector('abc', 16), /invalid dimension/);
});

test('errors are classified, carry no retry, and a missing model says how to install it', async (t) => {
  let { fake, embedder } = await make(t, { fail: () => ({ status: 404, body: { error: 'model "embeddinggemma" not found, try pulling it first' } }) });
  await assert.rejects(embedder.embed(['x text']), (err) => {
    assert.equal(err.kind, 'bad_request');
    assert.equal(err.modelMissing, true);
    assert.match(err.message, /ollama pull embeddinggemma/);
    return true;
  });
  assert.equal(fake.embedHits().length, 1);
  ({ fake, embedder } = await make(t, { fail: () => ({ status: 503, body: { error: 'busy' } }) }));
  await assert.rejects(embedder.embed(['x text']), { kind: 'unavailable' });
  assert.equal(fake.embedHits().length, 1, 'no automatic retry, even for a 5xx');
  ({ fake, embedder } = await make(t, { fail: () => ({ status: 429, body: { error: 'slow down' } }) }));
  await assert.rejects(embedder.embed(['x text']), { kind: 'bad_request' });
  assert.equal(fake.embedHits().length, 1);
});

test('a redirect is refused and never followed', async (t) => {
  const target = await startFakeOllama();
  t.after(target.close);
  const { embedder } = await make(t, { fail: () => ({ status: 307, headers: { location: `${target.baseUrl}/api/embed` }, body: '' }) });
  await assert.rejects(embedder.embed(['x text']), /redirect/);
  assert.equal(target.hits.length, 0, 'the redirect target must never be contacted');
});

test('timeout and cancellation: classified as timeout, signal is honoured', async (t) => {
  const { embedder } = await make(t, { delayMs: 400 }, { timeoutMs: 80 });
  await assert.rejects(embedder.embed(['x text']), { kind: 'timeout' });
  const slow = await make(t, { delayMs: 400 }, { timeoutMs: 5000 });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 40);
  await assert.rejects(slow.embedder.embed(['x text'], { signal: controller.signal }), { kind: 'timeout' });
  const closed = createOllamaEmbedder(embeddingProfile('http://127.0.0.1:9'));
  await assert.rejects(closed.embed(['x text']), { kind: 'unavailable' });
});

test('accounting: the request is counted BEFORE the HTTP call, failures are counted, a refusal sends nothing', async (t) => {
  const { fake, embedder } = await make(t, { fail: (n) => (n === 2 ? { status: 500 } : null) });
  const events = [];
  const accounting = { before: () => events.push(['before', fake.embedHits().length]), after: (r) => events.push(['after', r.ok, r.kind, r.inputs]) };
  await embedder.embed(['a text'], { accounting });
  await assert.rejects(embedder.embed(['b text', 'c text'], { accounting }), { kind: 'unavailable' });
  assert.deepEqual(events, [['before', 0], ['after', true, null, 1], ['before', 1], ['after', false, 'unavailable', 2]]);
  const refuse = { before: () => { throw Object.assign(new Error('budget'), { kind: 'budget' }); }, after: () => assert.fail('after() must not run when before() refuses') };
  await assert.rejects(embedder.embed(['d text'], { accounting: refuse }), { kind: 'budget' });
  assert.equal(fake.embedHits().length, 2, 'a refused request must not reach the network');
});

test('input is validated before any HTTP: empty, too long, too many', async (t) => {
  const { fake, embedder } = await make(t, {});
  await assert.rejects(embedder.embed([]), { kind: 'bad_request' });
  await assert.rejects(embedder.embed(['   ']), { kind: 'bad_request' });
  await assert.rejects(embedder.embed(['x'.repeat(8001)]), { kind: 'input_too_long' });
  await assert.rejects(embedder.embed(Array.from({ length: MAX_BATCH + 1 }, () => 'x text')), { kind: 'bad_request' });
  assert.equal(fake.hits.length, 0);
});

test('inspect() reads installed model and digest from /api/tags without an inference call', async (t) => {
  const { fake, embedder } = await make(t, {});
  assert.deepEqual(await embedder.inspect(), { installed: true, name: 'embeddinggemma:latest', digest: 'fakedigest0123456789', size_bytes: 622000000 });
  const none = await make(t, { models: [{ name: 'qwen3:8b', model: 'qwen3:8b', digest: 'abc', size: 1 }] });
  assert.equal((await none.embedder.inspect()).installed, false, 'a chat model is not mistaken for the embedding model');
  assert.ok(fake.hits.every((h) => h.url === '/api/tags'));
});

test('the embedding endpoint must be a plain origin: no credentials, path, query', () => {
  for (const bad of ['http://user:pw@127.0.0.1:11434', 'http://127.0.0.1:11434/v1/', 'http://127.0.0.1:11434?x=1', 'ftp://127.0.0.1', 'not a url']) {
    assert.throws(() => createOllamaEmbedder(embeddingProfile(bad)), undefined, bad);
  }
  assert.doesNotThrow(() => createOllamaEmbedder(embeddingProfile('http://127.0.0.1:11434')));
  assert.doesNotThrow(() => createOllamaEmbedder(embeddingProfile('http://127.0.0.1:11434/')));
});
