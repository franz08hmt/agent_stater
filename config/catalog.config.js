// Backend-owned allow-list. Never accept files, endpoints, credentials or code from HTTP.
import { createHash } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { validate } from '../src/tools/schema.js';
import { loadTaskConfig } from './task.config.js';
import { createModel } from '../src/model/index.js';
import { createConfiguredToolRegistry } from '../src/tools/registry.js';
import { createKeywordRetriever } from '../src/retrieval/keywordSearch.js';
import { createOllamaEmbedder } from '../src/rag/embedding.js';
import { createVectorRetriever } from '../src/rag/retriever.js';

const id = { type: 'string', pattern: '^[a-z][a-z0-9-]{0,59}$' };
const profileSchema = { type: 'object', additionalProperties: false, required: ['id', 'label'], properties: {
  id, label: { type: 'string', minLength: 1, maxLength: 80 }, source: { type: 'string', enum: ['env'] },
  provider: { type: 'string', enum: ['mock', 'openai-compatible'] }, name: { type: 'string', minLength: 1, maxLength: 120 },
  base_url: { type: 'string', minLength: 1, maxLength: 300 }, api_key_env: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{0,79}$' },
  requires_key: { type: 'boolean' }, json_mode: { type: 'boolean' }, reasoning_effort: { type: 'string', maxLength: 40 },
} };
// Embedding profiles are backend configuration: endpoint, model and prompt templates are never
// read from the browser, a task file or the LLM. Only an HTTP(S) Ollama origin is accepted.
const embeddingProfileSchema = { type: 'object', additionalProperties: false,
  required: ['id', 'label', 'provider', 'name', 'base_url', 'preprocessing_version', 'query_template', 'document_template'], properties: {
    id, label: { type: 'string', minLength: 1, maxLength: 80 }, provider: { type: 'string', enum: ['ollama'] },
    name: { type: 'string', minLength: 1, maxLength: 120 }, base_url: { type: 'string', minLength: 1, maxLength: 300 },
    preprocessing_version: { type: 'string', pattern: '^[a-z0-9][a-z0-9.-]{0,39}$' },
    query_template: { type: 'string', minLength: 6, maxLength: 200 }, document_template: { type: 'string', minLength: 6, maxLength: 300 },
    keep_alive: { type: 'string', pattern: '^[0-9]{1,4}[smh]$' }, timeout_ms: { type: 'integer', minimum: 1000, maximum: 120000 },
    dimensions: { type: 'integer', minimum: 8, maximum: 4096 },
    // 0 = run the (small) embedding model on the CPU so it never competes with the generation model for VRAM.
    num_gpu: { type: 'integer', minimum: 0, maximum: 999 },
  } };
const catalogSchema = { type: 'object', additionalProperties: false, required: ['default_task_id', 'default_model_profile_id', 'tasks', 'model_profiles'], properties: {
  default_task_id: id, default_model_profile_id: id,
  tasks: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['id', 'file'], properties: { id, file: { type: 'string', pattern: '^config/[A-Za-z0-9_-][A-Za-z0-9_.-]*\\.json$' } } } },
  model_profiles: { type: 'array', minItems: 1, maxItems: 10, items: profileSchema },
  embedding_profiles: { type: 'array', maxItems: 4, items: embeddingProfileSchema },
} };

export async function loadCatalog({ root, config, file = join(root, 'config/catalog.json'), virtualFiles, resolveCredentials = true }) {
  if (!(await lstat(join(root, 'config'))).isDirectory()) throw new Error('Catalog config directory must not be a symlink.');
  const text = virtualFiles?.get(relative(root, file).replaceAll('\\', '/'));
  if (text === undefined) {
    const info = await lstat(file);
    if (!info.isFile() || info.size > 24576) throw new Error('Catalog must be a regular JSON file under 24 KiB.');
  } else if (Buffer.byteLength(text) > 24576) throw new Error('Catalog preview exceeds 24 KiB.');
  const raw = JSON.parse(text ?? await readFile(file, 'utf8'));
  const errors = validate(catalogSchema, raw);
  if (errors.length) throw new Error(`Invalid catalog: ${errors.join('; ')}`);
  const embeddingProfiles = new Map();
  for (const def of raw.embedding_profiles ?? []) {
    if (embeddingProfiles.has(def.id)) throw new Error('Embedding profile IDs must be unique.');
    if (!def.query_template.includes('{text}') || !def.document_template.includes('{text}')) throw new Error('Embedding templates must contain {text}.');
    let origin;
    try { origin = new URL(def.base_url).origin; } catch { throw new Error('Embedding profile base_url is not a valid URL.'); }
    const templatesSha256 = createHash('sha256').update(JSON.stringify([def.query_template, def.document_template])).digest('hex');
    const identity = createHash('sha256').update(JSON.stringify({ id: def.id, provider: def.provider, name: def.name, origin, preprocessing: def.preprocessing_version,
      query: def.query_template, document: def.document_template, dimensions: def.dimensions ?? null, num_gpu: def.num_gpu ?? null })).digest('hex');
    embeddingProfiles.set(def.id, { id: def.id, label: def.label, provider: def.provider, name: def.name, baseUrl: def.base_url, preprocessingVersion: def.preprocessing_version,
      queryTemplate: def.query_template, documentTemplate: def.document_template, templatesSha256, dimensions: def.dimensions, keepAlive: def.keep_alive, numGpu: def.num_gpu, timeoutMs: def.timeout_ms, identity });
  }
  const tasks = [];
  for (const def of raw.tasks) {
    const task = await loadTaskConfig({ root, file: join(root, def.file), virtualFiles, embeddingProfiles });
    if (task.id !== def.id) throw new Error('Catalog task ID must match the validated task ID.');
    tasks.push(task);
  }
  const profiles = raw.model_profiles.map((def) => {
    if (def.source === 'env') {
      if (Object.keys(def).some((key) => !['id', 'label', 'source'].includes(key))) throw new Error('Environment profile cannot override model settings.');
      return { id: def.id, label: def.label, config: { ...config.model } };
    }
    if (!def.provider) throw new Error('Model profile must declare provider or source=env.');
    return { id: def.id, label: def.label, requiresKey: def.requires_key,
      config: { ...config.model, provider: def.provider, name: def.name || '', baseUrl: def.base_url || '', apiKey: resolveCredentials && def.api_key_env ? process.env[def.api_key_env] || '' : '',
        jsonMode: def.json_mode ?? true, reasoningEffort: def.reasoning_effort ?? '' } };
  });
  return buildCatalog({ tasks, profiles, embeddingProfiles, defaultTaskId: raw.default_task_id, defaultProfileId: raw.default_model_profile_id, virtualFiles, root });
}

export async function buildCatalog({ tasks, profiles, embeddingProfiles = new Map(), defaultTaskId, defaultProfileId, virtualFiles, root }) {
  const taskMap = new Map(), profileMap = new Map();
  for (const task of tasks) {
    if (!task?.fingerprint || !task.allowedTools?.length || taskMap.has(task.id)) throw new Error('Catalog tasks must be validated and unique.');
    const registry = createConfiguredToolRegistry(task.allowedTools, task.datasets, task);
    // A vector task gets a vector retriever (index state was read by the task loader, no HTTP here);
    // every other task keeps its BM25 retriever exactly as before.
    const vector = task.retrieval?.kind === 'vector';
    const embedding = vector ? embeddingProfiles.get(task.retrieval.embeddingProfileId) : null;
    const retriever = vector
      ? createVectorRetriever({ retrieval: task.retrieval, embedder: embedding ? createOllamaEmbedder(embedding) : null, indexState: task.retrieval.index })
      : await createKeywordRetriever({ dir: task.dataDir, virtualFiles, root });
    const tools = registry.describe().map(({ name, access, requires_approval, description }) => ({ name, access, requires_approval, description }));
    const metadata = { id: task.id, title: task.title, allowed_tools: [...task.allowedTools], tools,
      sample_inputs: structuredClone(task.sampleInputs), result_labels: { ...task.resultLabels },
      data: { retrieval: vector ? 'vector (cosine)' : registry.get('search_notes') ? retriever.kind : 'structured tables',
        note_count: vector ? task.retrieval.kb.chunkCount : registry.get('search_notes') ? retriever.sourceCount : 0,
        notes: vector ? task.retrieval.kb.chunks.slice(0, 40).map((c) => ({ source_id: c.source_id, title: c.section_label.slice(0, 120), passage_count: 1 }))
          : registry.get('search_notes') ? retriever.describe() : [],
        ...(vector ? { vector: {
          similarity: 'cosine (exact)', embedding_profile_id: task.retrieval.embeddingProfileId, embedding_model: embedding?.name ?? null,
          preprocessing_version: embedding?.preprocessingVersion ?? null, kb_title: task.retrieval.kb.title, kb_file: task.retrieval.kbFile,
          chunk_count: task.retrieval.kb.chunkCount, chunking: { unit: 'characters', ...task.retrieval.chunking }, top_k: task.retrieval.topK,
          required_sections: [...task.retrieval.requiredSections], context_max_chars: task.retrieval.context.maxChars,
          index_status: retriever.status, index_reason: retriever.reason, index_id: retriever.index?.index_id ?? null, index_dimension: retriever.index?.embedding.dimension ?? null,
        } } : {}),
        datasets: registry.get('query_dataset') || registry.get('compare_counts') ? task.datasets.map((d) => ({ id: d.id, columns: d.columns, row_count: d.rows.length, version: d.version })) : [] },
    };
    taskMap.set(task.id, { task, registry, retriever, metadata });
  }
  for (const def of profiles) {
    if (validate(id, def.id).length || !def.label || profileMap.has(def.id)) throw new Error('Model profile IDs must be valid and unique.');
    const cfg = { ...def.config };
    let reason = null, endpoint = '';
    if (!['mock', 'openai-compatible'].includes(cfg.provider)) reason = 'Unsupported model provider.';
    if (cfg.provider === 'openai-compatible') {
      try {
        const url = new URL(cfg.baseUrl);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
        endpoint = url.href;
        const needsKey = def.requiresKey ?? !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        if (needsKey && !cfg.apiKey) reason = 'Required credential is not configured.';
      } catch { reason = 'Model endpoint is not configured correctly.'; }
      if (!cfg.name) reason = 'Model name is not configured.';
    }
    const model = reason ? null : def.model || createModel(cfg);
    const provider = model?.provider ?? cfg.provider, name = model?.name ?? cfg.name, isMock = model?.isMock ?? cfg.provider === 'mock';
    const identity = createHash('sha256').update(JSON.stringify({ profile: def.id, provider, name, is_mock: isMock, endpoint,
      json_mode: cfg.jsonMode, reasoning_effort: cfg.reasoningEffort, temperature: cfg.temperature, max_output: model?.maxOutputTokens ?? cfg.maxOutputTokens })).digest('hex');
    const metadata = { id: def.id, label: def.label, provider, name, is_mock: isMock, status: reason ? 'unavailable' : 'configured', reason };
    profileMap.set(def.id, { ...def, config: cfg, model, identity, metadata });
  }
  if (!taskMap.has(defaultTaskId) || !profileMap.has(defaultProfileId)) throw new Error('Catalog defaults must name existing task/profile IDs.');
  return { tasks: taskMap, profiles: profileMap, embeddingProfiles, defaultTaskId, defaultProfileId,
    metadata() { return structuredClone({ default_task_id: this.defaultTaskId, default_model_profile_id: this.defaultProfileId,
      tasks: [...taskMap.values()].map((x) => x.metadata), model_profiles: [...profileMap.values()].map((x) => x.metadata) }); },
  };
}
