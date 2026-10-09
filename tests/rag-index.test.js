import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chunkMarkdown, kbChecksum, CHUNKER_VERSION } from '../src/rag/chunker.js';
import { buildIndexDocument, validateIndexDocument, checkFreshness, readIndexState, publishIndex, prepareVectors, cosineRank, indexIdOf, parseIndexText, describeIndex, IndexError } from '../src/rag/vectorIndex.js';
import { fakeVector } from './rag-helpers.js';
import { ROOT } from './helpers.js';

const KB_FILE = 'KB-B_Sunrise-Family-Clinic-Patient-Guide.md';
const kb = readFileSync(join(ROOT, 'data', 'sunrise', KB_FILE), 'utf8');
const CHUNKING = { max_chars: 1200, overlap_chars: 100 };
const EMBEDDING = { profile_id: 'fake-embed', provider: 'ollama', name: 'embeddinggemma', digest: 'abc123', dimension: 48, preprocessing_version: 'embeddinggemma-v1', truncate: false };

function build(over = {}) {
  const { chunks } = chunkMarkdown(kb, { fileName: KB_FILE });
  return buildIndexDocument({
    taskId: 'sunrise-clinic-rag', kb: { path: `data/sunrise/${KB_FILE}`, checksum_sha256: kbChecksum(kb), bytes: kb.length, title: 'Sunrise' },
    chunking: CHUNKING, chunkerVersion: CHUNKER_VERSION, embedding: EMBEDDING, chunks, vectors: chunks.map((c) => fakeVector(c.text)),
    accounting: { embedding_requests: 1 }, createdAt: '2026-10-09T00:00:00.000Z', ...over,
  });
}
const expected = (over = {}) => ({
  taskId: 'sunrise-clinic-rag', kbChecksum: kbChecksum(kb), chunking: CHUNKING, chunkerVersion: CHUNKER_VERSION,
  chunks: chunkMarkdown(kb, { fileName: KB_FILE }).chunks.map((c) => ({ source_id: c.source_id, text_sha256: c.text_sha256 })),
  embedding: { profileId: 'fake-embed', name: 'embeddinggemma', preprocessingVersion: 'embeddinggemma-v1' }, ...over,
});
const clone = (doc) => JSON.parse(JSON.stringify(doc));

test('a built index validates; index_id is deterministic and ignores created_at/accounting', () => {
  const a = build();
  assert.doesNotThrow(() => validateIndexDocument(clone(a)));
  const b = build({ createdAt: '2030-01-01T00:00:00.000Z', accounting: { embedding_requests: 99 } });
  assert.equal(a.index_id, b.index_id);
  assert.equal(a.chunks.length, 11);
  assert.ok(a.chunks.every((c) => c.vector.length === 48 && c.text_sha256));
  assert.notEqual(a.index_id, build({ embedding: { ...EMBEDDING, name: 'other' } }).index_id);
});

test('tampering is detected: vector, text, chunk removal, id and format', () => {
  const mutate = (fn) => { const d = clone(build()); fn(d); return d; };
  const cases = {
    'a vector value changed': (d) => { d.chunks[3].vector[5] += 0.5; },
    'chunk text changed': (d) => { d.chunks[3].text += ' extra'; },
    'a chunk removed': (d) => { d.chunks.pop(); },
    'index_id forged': (d) => { d.index_id = 'f'.repeat(64); },
    'format changed': (d) => { d.format = 'other'; },
    'zero vector': (d) => { d.chunks[0].vector = new Array(48).fill(0); },
    'null in a vector': (d) => { d.chunks[0].vector[2] = null; },
    'dimension mismatch': (d) => { d.chunks[1].vector = d.chunks[1].vector.slice(0, 40); },
    'duplicate chunk id': (d) => { d.chunks[1].source_id = d.chunks[0].source_id; },
    'bad chunk id': (d) => { d.chunks[1].source_id = 'Has Spaces'; },
    'no chunks': (d) => { d.chunks = []; },
    'missing embedding block': (d) => { delete d.embedding; },
  };
  for (const [name, fn] of Object.entries(cases)) assert.throws(() => validateIndexDocument(mutate(fn)), IndexError, name);
  assert.throws(() => parseIndexText('not json'), /not valid JSON/);
  assert.throws(() => parseIndexText('x'.repeat(9 * 1024 * 1024)), /too large/);
  assert.equal(indexIdOf(build()), build().index_id);
});

test('freshness: KB, chunking, chunker, embedding model, preprocessing and dimension changes all invalidate', () => {
  const doc = build();
  assert.deepEqual(checkFreshness(doc, expected()), { status: 'ready', reason: null });
  assert.equal(checkFreshness(doc, expected({ kbChecksum: kbChecksum(kb.replace('500,000', '999,000')) })).status, 'stale_kb');
  assert.match(checkFreshness(doc, expected({ chunking: { max_chars: 800, overlap_chars: 100 } })).reason, /chunk size/);
  assert.match(checkFreshness(doc, expected({ chunking: { max_chars: 1200, overlap_chars: 50 } })).reason, /chunk size or overlap/);
  assert.match(checkFreshness(doc, expected({ chunkerVersion: 'markdown-section-v2' })).reason, /chunker version/);
  assert.match(checkFreshness(doc, expected({ embedding: { profileId: 'fake-embed', name: 'nomic-embed-text', preprocessingVersion: 'embeddinggemma-v1' } })).reason, /embedding model/);
  assert.match(checkFreshness(doc, expected({ embedding: { profileId: 'fake-embed', name: 'embeddinggemma', preprocessingVersion: 'v2' } })).reason, /preprocessing/);
  assert.match(checkFreshness(doc, expected({ embedding: { profileId: 'fake-embed', name: 'embeddinggemma', preprocessingVersion: 'embeddinggemma-v1', dimensions: 256 } })).reason, /dimension/);
  assert.match(checkFreshness(doc, expected({ taskId: 'other-task' })).reason, /different task/);
  const rechunked = expected({ chunks: expected().chunks.map((c, i) => (i === 3 ? { ...c, text_sha256: 'e'.repeat(64) } : c)) });
  assert.match(checkFreshness(doc, rechunked).reason, /Re-chunking/, 'a chunker change is caught even if nobody bumped the version');
});

test('readIndexState: missing, invalid, stale and ready are distinguished; the vectors never leak into metadata', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'rag-index-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'sunrise', 'index.json');
  assert.equal((await readIndexState(file, expected())).status, 'missing');
  mkdirSync(join(dir, 'sunrise'), { recursive: true });
  writeFileSync(file, '{"format":"vector-index-v1"');
  assert.equal((await readIndexState(file, expected())).status, 'invalid');
  await publishIndex(file, build());
  const ready = await readIndexState(file, expected());
  assert.equal(ready.status, 'ready');
  assert.ok(ready.doc && ready.index_id);
  const meta = describeIndex(ready.doc);
  assert.equal(meta.chunk_count, 11);
  assert.equal(meta.embedding.dimension, 48);
  assert.ok(!JSON.stringify(meta).includes('vector'), 'metadata must not carry vectors');
  const stale = await readIndexState(file, expected({ kbChecksum: 'a'.repeat(64) }));
  assert.equal(stale.status, 'stale_kb');
  assert.equal(stale.doc, undefined, 'a stale index is never handed to the retriever');
});

test('publish is atomic: a failed build keeps the previous valid index and leaves no temp file', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'rag-publish-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'index.json');
  await publishIndex(file, build());
  const before = readFileSync(file, 'utf8');
  const broken = build();
  broken.chunks[2].vector[0] = null;
  await assert.rejects(publishIndex(file, broken), IndexError);
  assert.equal(readFileSync(file, 'utf8'), before, 'the old index is untouched');
  assert.deepEqual(readdirSync(dir), ['index.json'], 'no half-written temp file is left behind');
  const other = build({ embedding: { ...EMBEDDING, digest: 'zzz' } });
  await publishIndex(file, other);
  assert.equal(parseIndexText(readFileSync(file, 'utf8')).embedding.digest, 'zzz');
});

test('exact cosine ranking with hand-made vectors: order, scale invariance, ties, errors', () => {
  const docVectors = [[1, 0, 0, 0, 0, 0, 0, 0], [0.9, 0.1, 0, 0, 0, 0, 0, 0], [0, 1, 0, 0, 0, 0, 0, 0], [-1, 0, 0, 0, 0, 0, 0, 0], [5, 0, 0, 0, 0, 0, 0, 0]];
  const prepared = prepareVectors({ chunks: docVectors.map((vector) => ({ vector })) });
  const ranked = cosineRank(prepared, [1, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(ranked.map((r) => r.index), [0, 4, 1, 2, 3], 'identical direction first (ties keep chunk order), opposite last');
  assert.ok(Math.abs(ranked[0].score - 1) < 1e-12 && Math.abs(ranked[1].score - 1) < 1e-12, 'vector length does not matter, only direction');
  assert.ok(Math.abs(ranked.find((r) => r.index === 3).score + 1) < 1e-12);
  assert.ok(Math.abs(ranked.find((r) => r.index === 2).score) < 1e-12, 'orthogonal = 0');
  assert.deepEqual(cosineRank(prepared, [100, 0, 0, 0, 0, 0, 0, 0]).map((r) => r.index), [0, 4, 1, 2, 3], 'scaling the query changes nothing');
  assert.throws(() => cosineRank(prepared, [1, 0, 0]), /dimension/);
  assert.throws(() => cosineRank(prepared, new Array(8).fill(0)), /zero norm/);
});

test('real retrieval behaviour with the fake bag-of-words encoder: the fee question ranks fee sections first', () => {
  const doc = build();
  const prepared = prepareVectors(doc);
  const top = (q) => cosineRank(prepared, fakeVector(q)).slice(0, 2).map((r) => doc.chunks[r.index].section_number);
  assert.ok(top('What is the dermatology consultation fee').includes(4));
  assert.ok(top('Is the pharmacy open on Sunday').includes(9) || top('Is the pharmacy open on Sunday').includes(2));
});
