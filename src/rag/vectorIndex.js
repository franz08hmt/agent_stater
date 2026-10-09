// Vector index = a JSON file holding every chunk, its REAL embedding vector, and the identity
// needed to prove the vectors still belong to the knowledge base and model in use.
//
// Search is EXACT cosine similarity over all N chunk vectors: O(N x dimension) per query.
// That is a deliberate choice for a small knowledge base (here 11 chunks x 768 numbers).
// It is not an approximate-nearest-neighbour index and not a vector database server.

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, lstat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { canonicalJson } from '../agent/state.js';
import { assertVector, EmbeddingError } from './embedding.js';

export const INDEX_FORMAT = 'vector-index-v1';
export const MAX_INDEX_BYTES = 8 * 1024 * 1024;
export const MAX_CHUNKS = 500;

export class IndexError extends Error {
  constructor(message) { super(message); this.code = 'invalid_index'; }
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** Identifies what retrieval actually depends on. created_at and accounting are deliberately excluded. */
export function indexIdOf(doc) {
  return sha256(canonicalJson({
    format: doc.format, task_id: doc.task_id, kb: doc.kb, chunking: doc.chunking, chunker_version: doc.chunker_version, embedding: doc.embedding,
    chunks: doc.chunks.map((c) => [c.source_id, c.text_sha256, c.vector]),
  }));
}

export function buildIndexDocument({ taskId, kb, chunking, chunkerVersion, embedding, chunks, vectors, accounting, createdAt = new Date().toISOString() }) {
  if (chunks.length !== vectors.length) throw new IndexError('Vector count does not match chunk count.');
  const doc = {
    format: INDEX_FORMAT, task_id: taskId, created_at: createdAt, kb, chunking, chunker_version: chunkerVersion, embedding,
    chunks: chunks.map((c, i) => ({ ...c, vector: vectors[i] })), accounting,
  };
  doc.index_id = indexIdOf(doc);
  return doc;
}

/** Structural validation of a parsed index. Throws IndexError; never trusts the file. */
export function validateIndexDocument(doc) {
  if (!doc || typeof doc !== 'object' || doc.format !== INDEX_FORMAT) throw new IndexError('Unknown index format.');
  for (const key of ['task_id', 'kb', 'chunking', 'chunker_version', 'embedding', 'chunks', 'index_id']) if (doc[key] == null) throw new IndexError(`Index is missing "${key}".`);
  if (!Array.isArray(doc.chunks) || !doc.chunks.length || doc.chunks.length > MAX_CHUNKS) throw new IndexError('Index chunk count is out of range.');
  const dimension = doc.embedding.dimension;
  if (!Number.isInteger(dimension)) throw new IndexError('Index has no embedding dimension.');
  const ids = new Set();
  for (const chunk of doc.chunks) {
    if (typeof chunk.source_id !== 'string' || !/^[a-z0-9-]{1,60}$/.test(chunk.source_id) || ids.has(chunk.source_id)) throw new IndexError('Index chunk IDs must be unique and well formed.');
    ids.add(chunk.source_id);
    if (typeof chunk.text !== 'string' || !chunk.text.trim() || sha256(chunk.text) !== chunk.text_sha256) throw new IndexError(`Chunk ${chunk.source_id} text does not match its checksum.`);
    try { assertVector(chunk.vector, dimension, `vector of ${chunk.source_id}`); } catch (err) { if (err instanceof EmbeddingError) throw new IndexError(err.message); throw err; }
  }
  if (indexIdOf(doc) !== doc.index_id) throw new IndexError('Index content does not match its index_id (file modified or truncated).');
  return doc;
}

export function parseIndexText(text) {
  if (Buffer.byteLength(text) > MAX_INDEX_BYTES) throw new IndexError('Index file is too large.');
  let doc;
  try { doc = JSON.parse(text); } catch { throw new IndexError('Index file is not valid JSON.'); }
  return validateIndexDocument(doc);
}

/**
 * Is a structurally valid index still the right one?
 * @param expected {{taskId, kbChecksum, chunking, chunkerVersion, chunks:{source_id,text_sha256}[], embedding:{profileId,name,preprocessingVersion,dimensions?}}}
 * @returns {{status:'ready'|'stale_kb'|'stale_config', reason:string|null}}
 */
export function checkFreshness(doc, expected) {
  if (doc.task_id !== expected.taskId) return { status: 'stale_config', reason: 'Index belongs to a different task.' };
  if (doc.kb.checksum_sha256 !== expected.kbChecksum) return { status: 'stale_kb', reason: 'The knowledge base changed after the index was built.' };
  if (doc.chunker_version !== expected.chunkerVersion) return { status: 'stale_config', reason: 'The chunker version changed.' };
  if (doc.chunking.max_chars !== expected.chunking.max_chars || doc.chunking.overlap_chars !== expected.chunking.overlap_chars) return { status: 'stale_config', reason: 'The chunk size or overlap changed.' };
  const e = doc.embedding;
  if (e.profile_id !== expected.embedding.profileId || e.name !== expected.embedding.name) return { status: 'stale_config', reason: 'The embedding model or profile changed.' };
  if (e.preprocessing_version !== expected.embedding.preprocessingVersion) return { status: 'stale_config', reason: 'The embedding preprocessing (prompt templates) changed.' };
  if (expected.embedding.templatesSha256 && e.templates_sha256 !== expected.embedding.templatesSha256) return { status: 'stale_config', reason: 'The embedding prompt templates changed.' };
  if (expected.embedding.dimensions && e.dimension !== expected.embedding.dimensions) return { status: 'stale_config', reason: 'The embedding dimension changed.' };
  const same = doc.chunks.length === expected.chunks.length && doc.chunks.every((c, i) => c.source_id === expected.chunks[i].source_id && c.text_sha256 === expected.chunks[i].text_sha256);
  if (!same) return { status: 'stale_config', reason: 'Re-chunking the current knowledge base gives different chunks than the index (chunker or KB changed).' };
  return { status: 'ready', reason: null };
}

/** Reads and judges an index file. Never throws for ordinary problems; returns a status instead. */
export async function readIndexState(file, expected) {
  let info;
  try { info = await lstat(file); } catch (err) { if (err.code === 'ENOENT') return { status: 'missing', reason: 'No index has been built yet.' }; return { status: 'invalid', reason: 'Index file cannot be read.' }; }
  if (!info.isFile() || info.size > MAX_INDEX_BYTES) return { status: 'invalid', reason: 'Index must be a regular file within the size limit.' };
  let doc;
  try { doc = parseIndexText(await readFile(file, 'utf8')); } catch (err) { return { status: 'invalid', reason: err instanceof IndexError ? err.message : 'Index file cannot be read.' }; }
  const fresh = checkFreshness(doc, expected);
  return { ...fresh, index_id: doc.index_id, ...(fresh.status === 'ready' ? { doc } : {}) };
}

/**
 * Publish atomically: write a temp file, fsync, re-read and validate it, then rename over the old
 * index. A failure at any step leaves the previous valid index untouched.
 */
export async function publishIndex(file, doc) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temp, 'wx');
    try { await handle.writeFile(JSON.stringify(doc), 'utf8'); await handle.sync(); } finally { await handle.close(); }
    parseIndexText(await readFile(temp, 'utf8')); // what is about to be published must itself be valid
    await rename(temp, file);
  } catch (err) {
    await unlink(temp).catch(() => {});
    throw err;
  }
}

/** Unit-length copies so cosine similarity is a plain dot product. */
export function prepareVectors(doc) {
  return doc.chunks.map((c) => {
    const norm = Math.sqrt(c.vector.reduce((s, v) => s + v * v, 0));
    return Float64Array.from(c.vector, (v) => v / norm);
  });
}

/** Exact cosine ranking. Ties keep chunk order, so results are deterministic. */
export function cosineRank(prepared, queryVector) {
  if (!prepared.length || queryVector.length !== prepared[0].length) throw new IndexError('Query vector dimension does not match the index.');
  let norm = 0;
  for (const v of queryVector) norm += v * v;
  norm = Math.sqrt(norm);
  if (!(norm > 1e-12)) throw new IndexError('Query vector has zero norm.');
  return prepared
    .map((vector, index) => {
      let dot = 0;
      for (let i = 0; i < vector.length; i++) dot += vector[i] * queryVector[i];
      return { index, score: dot / norm };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

/** Safe metadata for the UI and reports: never the vectors. */
export function describeIndex(doc) {
  return {
    index_id: doc.index_id, kb_title: doc.kb.title, kb_checksum_sha256: doc.kb.checksum_sha256, chunk_count: doc.chunks.length,
    chunking: { unit: 'characters', ...doc.chunking }, chunker_version: doc.chunker_version, created_at: doc.created_at,
    embedding: { profile_id: doc.embedding.profile_id, name: doc.embedding.name, digest: doc.embedding.digest ?? null, dimension: doc.embedding.dimension, preprocessing_version: doc.embedding.preprocessing_version, templates_sha256: doc.embedding.templates_sha256 ?? null },
  };
}
