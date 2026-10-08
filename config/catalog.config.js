// Backend-owned allow-list. Never accept files, endpoints, credentials or code from HTTP.
import { createHash } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { validate } from '../src/tools/schema.js';
import { loadTaskConfig } from './task.config.js';
import { createModel } from '../src/model/index.js';
import { createConfiguredToolRegistry } from '../src/tools/registry.js';
import { createKeywordRetriever } from '../src/retrieval/keywordSearch.js';

const id = { type: 'string', pattern: '^[a-z][a-z0-9-]{0,59}$' };
const profileSchema = { type: 'object', additionalProperties: false, required: ['id', 'label'], properties: {
  id, label: { type: 'string', minLength: 1, maxLength: 80 }, source: { type: 'string', enum: ['env'] },
  provider: { type: 'string', enum: ['mock', 'openai-compatible'] }, name: { type: 'string', minLength: 1, maxLength: 120 },
  base_url: { type: 'string', minLength: 1, maxLength: 300 }, api_key_env: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{0,79}$' },
  requires_key: { type: 'boolean' }, json_mode: { type: 'boolean' }, reasoning_effort: { type: 'string', maxLength: 40 },
} };
const catalogSchema = { type: 'object', additionalProperties: false, required: ['default_task_id', 'default_model_profile_id', 'tasks', 'model_profiles'], properties: {
  default_task_id: id, default_model_profile_id: id,
  tasks: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'object', additionalProperties: false, required: ['id', 'file'], properties: { id, file: { type: 'string', pattern: '^config/[A-Za-z0-9_-][A-Za-z0-9_.-]*\\.json$' } } } },
  model_profiles: { type: 'array', minItems: 1, maxItems: 10, items: profileSchema },
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
  const tasks = [];
  for (const def of raw.tasks) {
    const task = await loadTaskConfig({ root, file: join(root, def.file), virtualFiles });
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
  return buildCatalog({ tasks, profiles, defaultTaskId: raw.default_task_id, defaultProfileId: raw.default_model_profile_id, virtualFiles, root });
}

export async function buildCatalog({ tasks, profiles, defaultTaskId, defaultProfileId, virtualFiles, root }) {
  const taskMap = new Map(), profileMap = new Map();
  for (const task of tasks) {
    if (!task?.fingerprint || !task.allowedTools?.length || taskMap.has(task.id)) throw new Error('Catalog tasks must be validated and unique.');
    const registry = createConfiguredToolRegistry(task.allowedTools, task.datasets, task);
    const retriever = await createKeywordRetriever({ dir: task.dataDir, virtualFiles, root });
    const tools = registry.describe().map(({ name, access, requires_approval, description }) => ({ name, access, requires_approval, description }));
    const metadata = { id: task.id, title: task.title, allowed_tools: [...task.allowedTools], tools,
      sample_inputs: structuredClone(task.sampleInputs), result_labels: { ...task.resultLabels },
      data: { retrieval: registry.get('search_notes') ? retriever.kind : 'structured tables',
        note_count: registry.get('search_notes') ? retriever.sourceCount : 0,
        notes: registry.get('search_notes') ? retriever.describe() : [],
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
  return { tasks: taskMap, profiles: profileMap, defaultTaskId, defaultProfileId,
    metadata() { return structuredClone({ default_task_id: this.defaultTaskId, default_model_profile_id: this.defaultProfileId,
      tasks: [...taskMap.values()].map((x) => x.metadata), model_profiles: [...profileMap.values()].map((x) => x.metadata) }); },
  };
}
