// Builds the vector index for one task: chunks (already produced by the task loader) -> real
// embeddings from the configured embedding model -> validated index document.
// Run by the explicit `npm run rag:index` command only; the server, the UI, reloads and task
// selection never trigger embedding of the knowledge base.
//
// This accounting is for INDEXING and lives outside any run: query embeddings are counted per run.

import { buildIndexDocument, validateIndexDocument } from './vectorIndex.js';
import { createOllamaEmbedder, EmbeddingError } from './embedding.js';
import { CHUNKER_VERSION } from './chunker.js';
import { createHash } from 'node:crypto';

const BATCH_SIZE = 16;

export class BlockedError extends Error {
  constructor(message, hint) { super(message); this.blocked = true; this.hint = hint; }
}

export function newBuildAccounting(maxRequests) {
  const a = { max_requests: maxRequests, requests: 0, failed: 0, inputs: 0, ms: 0, input_tokens_reported: null, usage_missing_requests: 0 };
  return {
    totals: a,
    hooks: {
      before() { if (a.requests >= a.max_requests) throw new EmbeddingError('bad_request', `Index-build embedding request cap reached (${a.requests}/${a.max_requests}).`); a.requests += 1; },
      after({ ok, usage, ms, inputs }) {
        a.ms += ms; a.inputs += inputs;
        if (!ok) a.failed += 1;
        if (ok && usage?.valid) a.input_tokens_reported = (a.input_tokens_reported ?? 0) + usage.input_tokens; else a.usage_missing_requests += 1;
      },
    },
  };
}

/**
 * @param task validated task (task.retrieval.kb.chunks, .kb, .chunking, ...)
 * @param profile embedding profile from the catalog
 */
export async function buildTaskIndex({ task, profile, signal, maxRequests = 4, timeoutMs = 60000, createdAt }) {
  const retrieval = task.retrieval;
  if (retrieval?.kind !== 'vector') throw new Error(`Task "${task.id}" has no vector retrieval declaration.`);
  // An explicit, longer deadline than a query has: the first call may have to load the model into memory.
  const embedder = createOllamaEmbedder({ ...profile, timeoutMs });
  let inspected;
  try { inspected = await embedder.inspect({ signal }); }
  catch (err) {
    if (err instanceof EmbeddingError && ['unavailable', 'timeout'].includes(err.kind)) throw new BlockedError(`Ollama is not reachable: ${err.message}`, 'Start Ollama, then run this command again.');
    throw err;
  }
  if (!inspected.installed) throw new BlockedError(`The embedding model "${profile.name}" is not installed.`, `Install it yourself (about 622 MB for embeddinggemma): ollama pull ${profile.name}`);

  const chunks = retrieval.kb.chunks;
  const accounting = newBuildAccounting(maxRequests);
  const texts = chunks.map((c) => embedder.documentText({ title: `${retrieval.kb.title} — ${c.section_label}`, text: c.text }));
  const vectors = [];
  let dimension = null;
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const out = await embedder.embed(texts.slice(i, i + BATCH_SIZE), { signal, accounting: accounting.hooks, expectedDimension: dimension ?? undefined });
    dimension ??= out.dimension;
    vectors.push(...out.vectors);
  }
  const doc = buildIndexDocument({
    taskId: task.id,
    kb: { file: retrieval.kbFile, checksum_sha256: retrieval.kb.checksum, bytes: retrieval.kb.bytes, title: retrieval.kb.title },
    chunking: { ...retrieval.chunking }, chunkerVersion: CHUNKER_VERSION,
    embedding: {
      profile_id: profile.id, provider: profile.provider, name: profile.name, digest: inspected.digest, dimension,
      preprocessing_version: profile.preprocessingVersion, templates_sha256: profile.templatesSha256 ?? createHash('sha256').update(JSON.stringify([profile.queryTemplate, profile.documentTemplate])).digest('hex'), truncate: false,
    },
    chunks: chunks.map((c) => ({ ...c })), vectors,
    accounting: { ...accounting.totals, scope: 'index-build' }, createdAt,
  });
  validateIndexDocument(doc);
  return { doc, accounting: accounting.totals, inspected };
}
