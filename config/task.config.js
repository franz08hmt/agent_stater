// Backend-validated exam task snapshots. Validation never loads code,
// grants unregistered tools, or allows paths outside ./data.
import { createHash } from 'node:crypto';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { validate } from '../src/tools/schema.js';
import { BUILTIN_TOOLS } from '../src/tools/registry.js';
import { datasetsSchema, loadDatasets } from '../src/data/datasets.js';

const MAX_FILE_BYTES = 16 * 1024;
const KNOWN_TOOLS = Object.keys(BUILTIN_TOOLS);
const schema = {
  type: 'object', additionalProperties: false,
  required: ['id', 'title', 'mission', 'data', 'allowed_tools', 'sample_inputs', 'result_labels'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 60, pattern: '^[a-z][a-z0-9-]*$' },
    title: { type: 'string', minLength: 1, maxLength: 80 },
    mission: { type: 'string', minLength: 20, maxLength: 2400 },
    data: { type: 'object', additionalProperties: false, required: ['notes_dir'], properties: {
      notes_dir: { type: 'string', minLength: 6, maxLength: 160 },
      datasets: datasetsSchema,
    } },
    allowed_tools: { type: 'array', minItems: 1, maxItems: KNOWN_TOOLS.length, uniqueItems: true, items: { type: 'string', enum: KNOWN_TOOLS } },
    sample_inputs: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'object', additionalProperties: false, required: ['label', 'goal'], properties: {
      label: { type: 'string', minLength: 1, maxLength: 45 }, goal: { type: 'string', minLength: 1, maxLength: 500 },
    } } },
    result_labels: { type: 'object', additionalProperties: false, required: ['answer', 'sources', 'unresolved'], properties: {
      answer: { type: 'string', minLength: 1, maxLength: 60 },
      sources: { type: 'string', minLength: 1, maxLength: 60 },
      unresolved: { type: 'string', minLength: 1, maxLength: 60 },
    } },
  },
};

function invalid(message) { throw new Error(`Invalid config/task.json: ${message}`); }

export async function validateTaskConfig(raw, root) {
  const errors = validate(schema, raw);
  if (errors.length) invalid(errors.join('; ').replace('allowed_tools: items must be unique', 'allowed_tools: duplicate tools'));
  if (new Set(raw.sample_inputs.map((x) => x.label.toLowerCase())).size !== raw.sample_inputs.length) invalid('sample_inputs: duplicate labels');
  if (raw.allowed_tools.includes('save_draft') && !raw.allowed_tools.includes('search_notes')) invalid('save_draft requires search_notes for grounded drafts.');
  if (raw.allowed_tools.includes('query_dataset') && !raw.data.datasets?.length) invalid('query_dataset requires at least one allowed dataset in data.datasets.');
  let datasets;
  try { datasets = await loadDatasets(raw.data.datasets, root); }
  catch (err) { invalid(err.message); }

  const rel = raw.data.notes_dir;
  if (!/^data\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(rel)) invalid('data.notes_dir must be a project-local directory under data/ with no traversal or absolute path.');
  let dir = root;
  for (const part of rel.split('/')) {
    dir = join(dir, part);
    const info = await lstat(dir).catch(() => invalid(`data.notes_dir: ${rel} does not exist.`));
    if (!info.isDirectory() || info.isSymbolicLink()) invalid(`data.notes_dir: ${part} must be a real directory, not a link.`);
  }
  const files = (await readdir(dir)).filter((name) => name.endsWith('.md')).sort();
  if (!files.length) invalid('data.notes_dir must contain at least one .md note.');
  const digest = createHash('sha256').update(JSON.stringify(raw));
  for (const dataset of datasets) digest.update(dataset.id).update(dataset.version);
  for (const name of files) {
    const note = join(dir, name);
    if (!(await lstat(note)).isFile()) invalid(`data.notes_dir: ${name} must be a regular file, not a symlink.`);
    digest.update(name).update(await readFile(note));
  }
  return {
    id: raw.id, title: raw.title.trim(), mission: raw.mission.trim(),
    dataDir: dir, allowedTools: [...raw.allowed_tools], datasets,
    sampleInputs: raw.sample_inputs.map((x) => ({ label: x.label.trim(), goal: x.goal.trim() })),
    resultLabels: { ...raw.result_labels }, fingerprint: digest.digest('hex'),
  };
}

export async function loadTaskConfig({ root, file = join(root, 'config', 'task.json') }) {
  const info = await lstat(file).catch(() => invalid(`missing task file: ${file}`));
  if (!info.isFile() || info.size > MAX_FILE_BYTES) invalid(`task file must be a regular JSON file under ${MAX_FILE_BYTES} bytes.`);
  let raw;
  try { raw = JSON.parse(await readFile(file, 'utf8')); }
  catch (err) { invalid(`could not parse JSON: ${err.message}`); }
  return validateTaskConfig(raw, root);
}
