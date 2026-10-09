// Backend-validated exam task snapshots. Validation never loads code,
// grants unregistered tools, or allows paths outside ./data.
import { createHash } from 'node:crypto';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { validate } from '../src/tools/schema.js';
import { BUILTIN_TOOLS } from '../src/tools/registry.js';
import { datasetsSchema, loadDatasets } from '../src/data/datasets.js';
import { proposalPoliciesSchema, bindPolicies, policyFingerprint } from '../src/proposals/policies.js';
import { assertAssetDataset } from '../src/business/assetAvailability.js';
import { chunkMarkdown, kbChecksum, CHUNKER_VERSION } from '../src/rag/chunker.js';
import { readIndexState } from '../src/rag/vectorIndex.js';

const MAX_FILE_BYTES = 16 * 1024;
const KNOWN_TOOLS = Object.keys(BUILTIN_TOOLS);
export const taskConfigSchema = {
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
    proposal_policies: proposalPoliciesSchema,
    // Optional. Absent = the task keeps its existing behaviour (BM25 notes, datasets, ...).
    retrieval: { type: 'object', additionalProperties: false,
      required: ['kind', 'embedding_profile_id', 'kb_file', 'chunking', 'top_k', 'required_sections', 'context'],
      properties: {
        kind: { type: 'string', enum: ['vector'] },
        embedding_profile_id: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,59}$' },
        kb_file: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\\.md$' },
        chunking: { type: 'object', additionalProperties: false, required: ['max_chars', 'overlap_chars'], properties: {
          max_chars: { type: 'integer', minimum: 200, maximum: 4000 }, overlap_chars: { type: 'integer', minimum: 0, maximum: 1000 } } },
        top_k: { type: 'integer', minimum: 1, maximum: 8 },
        required_sections: { type: 'array', maxItems: 4, uniqueItems: true, items: { type: 'integer', minimum: 1, maximum: 99 } },
        context: { type: 'object', additionalProperties: false, required: ['max_chars', 'max_chunks'], properties: {
          max_chars: { type: 'integer', minimum: 1000, maximum: 6000 }, max_chunks: { type: 'integer', minimum: 1, maximum: 12 } } },
      } },
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

const MAX_KB_BYTES = 256 * 1024;

/**
 * Validates the vector-retrieval declaration against the real KB file and reads the state of the
 * index WITHOUT requiring it: a task with a valid declaration but no index yet must still load,
 * otherwise the command that builds the index could never run.
 */
async function resolveRetrieval(raw, { root, dir, files, virtualFiles, embeddingProfiles }) {
  const r = raw.retrieval;
  // A scaffold preview may load the whole catalog with an overlay; only a KB that exists solely in the overlay is unsupported.
  if (virtualFiles?.has(`${raw.data.notes_dir}/${r.kb_file}`)) invalid('retrieval is not supported for a knowledge base that exists only in a scaffold preview.');
  if (!files.includes(r.kb_file)) invalid(`retrieval.kb_file "${r.kb_file}" is not a .md file in data.notes_dir.`);
  const kbPath = join(dir, r.kb_file);
  const info = await lstat(kbPath);
  if (!info.isFile() || info.size > MAX_KB_BYTES) invalid(`retrieval.kb_file must be a regular file under ${MAX_KB_BYTES} bytes.`);
  const text = await readFile(kbPath, 'utf8');
  let chunked;
  try { chunked = chunkMarkdown(text, { fileName: r.kb_file, maxChars: r.chunking.max_chars, overlapChars: r.chunking.overlap_chars }); }
  catch (err) { invalid(`retrieval chunking: ${err.message}`); }
  const sections = new Set(chunked.chunks.map((c) => c.section_number));
  for (const n of r.required_sections) if (!sections.has(n)) invalid(`retrieval.required_sections: section ${n} does not exist in the knowledge base.`);
  const requiredChunks = chunked.chunks.filter((c) => r.required_sections.includes(c.section_number)).length;
  if (r.top_k + requiredChunks > r.context.max_chunks) invalid('retrieval.context.max_chunks must fit top_k plus every required chunk.');
  const profile = embeddingProfiles?.get(r.embedding_profile_id);
  if (embeddingProfiles && !profile) invalid(`retrieval.embedding_profile_id "${r.embedding_profile_id}" is not a registered embedding profile.`);
  const checksum = kbChecksum(text);
  const indexFile = join(root, 'var', 'rag', raw.id, 'index.json');
  const index = profile
    ? await readIndexState(indexFile, {
      taskId: raw.id, kbChecksum: checksum, chunking: r.chunking, chunkerVersion: CHUNKER_VERSION,
      chunks: chunked.chunks.map((c) => ({ source_id: c.source_id, text_sha256: c.text_sha256 })),
      embedding: { profileId: profile.id, name: profile.name, preprocessingVersion: profile.preprocessingVersion, templatesSha256: profile.templatesSha256, dimensions: profile.dimensions },
    })
    : { status: 'unconfigured', reason: 'The embedding profile is not available to this loader.' };
  return {
    kind: 'vector', embeddingProfileId: r.embedding_profile_id, kbFile: r.kb_file,
    kb: { title: chunked.document.title, checksum, bytes: info.size, documentId: chunked.document.id, chunkCount: chunked.chunks.length, chunks: chunked.chunks },
    chunking: { ...r.chunking }, topK: r.top_k, requiredSections: [...r.required_sections], context: { maxChars: r.context.max_chars, maxChunks: r.context.max_chunks },
    indexFile, index, profileIdentity: profile?.identity ?? null,
  };
}

export async function validateTaskConfig(raw, root, virtualFiles, embeddingProfiles) {
  const errors = validate(taskConfigSchema, raw);
  if (errors.length) invalid(errors.join('; ').replace('allowed_tools: items must be unique', 'allowed_tools: duplicate tools'));
  if (new Set(raw.sample_inputs.map((x) => x.label.toLowerCase())).size !== raw.sample_inputs.length) invalid('sample_inputs: duplicate labels');
  if (raw.allowed_tools.includes('save_draft') && !raw.allowed_tools.includes('search_notes')) invalid('save_draft requires search_notes for grounded drafts.');
  if (raw.allowed_tools.includes('search_kb') !== Boolean(raw.retrieval)) invalid('search_kb and the retrieval declaration require each other.');
  if (raw.retrieval && raw.allowed_tools.some((tool) => !['search_kb', 'calculate'].includes(tool))) invalid('A vector-retrieval task may allow only search_kb and calculate: it is a read-only knowledge-base task.');
  if (raw.allowed_tools.includes('calculate') && !raw.retrieval) invalid('calculate is only available to vector-retrieval knowledge-base tasks.');
  for (const tool of ['query_dataset', 'compare_counts', 'check_asset_availability']) {
    if (raw.allowed_tools.includes(tool) && !raw.data.datasets?.length) invalid(`${tool} requires at least one allowed dataset in data.datasets.`);
  }
  let datasets;
  try { datasets = await loadDatasets(raw.data.datasets, root, virtualFiles); }
  catch (err) { invalid(err.message); }
  if (raw.allowed_tools.includes('check_asset_availability')) {
    try { for (const data of datasets) assertAssetDataset(data); } catch (err) { invalid(err.message); }
  }
  let proposalPolicies;
  try { proposalPolicies = bindPolicies(raw.proposal_policies, datasets); } catch (err) { invalid(err.message); }
  if (raw.allowed_tools.includes('create_proposal') && (!raw.allowed_tools.includes('query_dataset') || !proposalPolicies.length)) invalid('create_proposal requires query_dataset and registered proposal policies.');
  if (proposalPolicies.length && !raw.allowed_tools.includes('create_proposal')) invalid('proposal policies require create_proposal permission.');

  const rel = raw.data.notes_dir;
  if (!/^data\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(rel)) invalid('data.notes_dir must be a project-local directory under data/ with no traversal or absolute path.');
  const virtualNotes = [...(virtualFiles?.keys() || [])].filter((file) => file.startsWith(`${rel}/`) && !file.slice(rel.length + 1).includes('/') && file.endsWith('.md'));
  let dir = root;
  for (const part of rel.split('/')) {
    dir = join(dir, part);
    const info = await lstat(dir).catch((err) => { if (err.code === 'ENOENT' && virtualNotes.length) return null; invalid(`data.notes_dir: ${rel} does not exist.`); });
    if (info && (!info.isDirectory() || info.isSymbolicLink())) invalid(`data.notes_dir: ${part} must be a real directory, not a link.`);
  }
  const diskFiles = await readdir(dir).catch((err) => { if (err.code === 'ENOENT' && virtualNotes.length) return []; throw err; });
  const files = [...new Set([...diskFiles.filter((name) => name.endsWith('.md')), ...virtualNotes.map((file) => file.slice(rel.length + 1))])].sort();
  if (!files.length) invalid('data.notes_dir must contain at least one .md note.');
  const retrieval = raw.retrieval ? await resolveRetrieval(raw, { root, dir, files, virtualFiles, embeddingProfiles }) : null;
  const digest = createHash('sha256').update(JSON.stringify(raw));
  // Index state and embedding identity are part of the task snapshot: rebuilding the index or
  // changing the embedding model must make an old active run fail with task_changed.
  if (retrieval) digest.update('vector-retrieval').update(JSON.stringify({ index_status: retrieval.index.status, index_id: retrieval.index.index_id ?? null, profile: retrieval.profileIdentity }));
  if (proposalPolicies.length || raw.allowed_tools.includes('check_asset_availability')) digest.update(await policyFingerprint());
  for (const dataset of datasets) digest.update(dataset.id).update(dataset.version);
  for (const name of files) {
    const note = join(dir, name);
    if (virtualFiles?.has(`${rel}/${name}`)) { digest.update(name).update(Buffer.from(virtualFiles.get(`${rel}/${name}`), 'utf8')); continue; }
    if (!(await lstat(note)).isFile()) invalid(`data.notes_dir: ${name} must be a regular file, not a symlink.`);
    digest.update(name).update(await readFile(note));
  }
  return {
    id: raw.id, title: raw.title.trim(), mission: raw.mission.trim(),
    dataDir: dir, allowedTools: [...raw.allowed_tools], datasets, proposalPolicies,
    sampleInputs: raw.sample_inputs.map((x) => ({ label: x.label.trim(), goal: x.goal.trim() })),
    resultLabels: { ...raw.result_labels }, retrieval, fingerprint: digest.digest('hex'),
  };
}

export async function loadTaskConfig({ root, file = join(root, 'config', 'task.json'), virtualFiles, embeddingProfiles }) {
  const key = relative(root, file).replaceAll('\\', '/'), text = virtualFiles?.get(key);
  if (text !== undefined) {
    if (!/^config\/[A-Za-z0-9_.-]+\.json$/.test(key) || Buffer.byteLength(text) > MAX_FILE_BYTES) invalid('Invalid preview task file.');
  } else {
    const info = await lstat(file).catch(() => invalid(`missing task file: ${file}`));
    if (!info.isFile() || info.size > MAX_FILE_BYTES) invalid(`task file must be a regular JSON file under ${MAX_FILE_BYTES} bytes.`);
  }
  let raw;
  try { raw = JSON.parse(text ?? await readFile(file, 'utf8')); }
  catch (err) { invalid(`could not parse JSON: ${err.message}`); }
  const task = await validateTaskConfig(raw, root, virtualFiles, embeddingProfiles);
  task.verifyCurrent = async () => {
    try { return (await loadTaskConfig({ root, file, embeddingProfiles })).fingerprint === task.fingerprint; } catch { return false; }
  };
  return task;
}
