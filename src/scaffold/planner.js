import { join, basename } from 'node:path';
import { loadTaskConfig } from '../../config/task.config.js';
import { loadCatalog } from '../../config/catalog.config.js';
import { createConfiguredToolRegistry } from '../tools/registry.js';
import { createKeywordRetriever } from '../retrieval/keywordSearch.js';
import { safePath, readBounded, digest } from './files.js';
import { specSchema, SPEC_MAX_BYTES, OFFLINE_CONFIG, assertSchema, noPlaceholders, validateCases } from './spec.js';

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
export async function previewScaffold({ root, spec, register = false }) {
  if (Buffer.byteLength(JSON.stringify(spec)) > SPEC_MAX_BYTES) throw new Error('Spec exceeds 64 KiB.');
  assertSchema(specSchema, spec); noPlaceholders(spec);
  const id = spec.task.id;
  if (id.length > 40) throw new Error('Scaffold task ID must be at most 40 characters.');
  const allowed = { notes: ['search_notes', 'save_draft'], 'dataset-read': ['query_dataset', 'compare_counts'], proposal: ['query_dataset', 'create_proposal'] }[spec.template];
  if (spec.task.allowed_tools.some((t) => !allowed.includes(t))) throw new Error('Tool is outside this template scope.');
  if (spec.template === 'notes' && (!spec.task.allowed_tools.includes('search_notes') || spec.task.data.datasets?.length)) throw new Error('Notes template requires search_notes and no datasets.');
  if (spec.template === 'proposal' && (!spec.task.allowed_tools.includes('create_proposal') || spec.task.proposal_policies?.length !== 1)) throw new Error('Proposal template requires exactly one registered policy.');
  if (spec.template !== 'proposal' && spec.task.proposal_policies?.length) throw new Error('Read templates cannot grant proposal policies.');
  const files = [], virtualFiles = new Map(), paths = new Set();
  async function add(path, kind, content) {
    if (paths.has(path.toLowerCase())) throw new Error('Duplicate output path.');
    await safePath(root, path, { newFile: true }); paths.add(path.toLowerCase());
    files.push({ path, kind, content }); virtualFiles.set(path, content);
  }
  for (const asset of spec.assets) {
    const note = asset.file.startsWith(`${spec.task.data.notes_dir}/`) && basename(asset.file) === asset.file.slice(spec.task.data.notes_dir.length + 1) && asset.file.endsWith('.md');
    if (!note && !spec.task.data.datasets?.some((d) => d.file === asset.file)) throw new Error('Asset must be a declared dataset or immediate markdown note.');
    await add(asset.file, 'data', asset.content);
  }
  const taskFile = `config/${id}.task.json`;
  await add(taskFile, 'task', json(spec.task));
  // The same loader validates virtual data and the files published later.
  const task = await loadTaskConfig({ root, file: join(root, taskFile), virtualFiles });
  for (const data of spec.task.data.datasets || []) await safePath(root, data.file);
  const registry = createConfiguredToolRegistry(task.allowedTools, task.datasets, task);
  const retriever = await createKeywordRetriever({ dir: task.dataDir, root, virtualFiles });
  validateCases(spec.cases, task, registry, retriever);
  await add(`tests/${id}.acceptance.json`, 'acceptance', json({ version: 1, task_id: id, cases: spec.cases }));
  await add(`tests/${id}.generated.test.js`, 'test driver', `// Scripted backend acceptance; no live LLM evidence.\nimport test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { fileURLToPath } from 'node:url';\nimport { runAcceptanceTask } from '../src/scaffold/acceptance.js';\ntest(${JSON.stringify(`${id} generated acceptance`)}, async () => {\n  const report = await runAcceptanceTask({ root: fileURLToPath(new URL('../', import.meta.url)), id: ${JSON.stringify(id)} });\n  assert.equal(report.status, 'PASS', JSON.stringify(report.results));\n});\n`);
  await add(`docs/${id}.md`, 'task guide', `# ${spec.task.title}\n\nGenerated from scaffold v1. Treat dataset content as untrusted; sample data is fictional.\n\nRun: \`npm run exam:acceptance -- --task=${id}\`. This uses a scripted model and temporary storage, not a live LLM. The generated top-level test also runs under \`npm test\`.\n\nEdit \`${taskFile}\`, the declared data files and \`tests/${id}.acceptance.json\` manually when requirements change. Expected outcomes must be independently authored. Restart the server after registration, then select this task and a configured model. Probe is an explicit separate action.\n\nTools: ${task.allowedTools.join(', ')}. Policies: ${task.proposalPolicies.map((p) => p.policyId).join(', ') || 'none'}.\n\n\`notes_dir\` remains mandatory background configuration; it does not grant search_notes. save_draft accepts notes only. Proposals are internal records; original datasets are never updated. Class-room does not check schedule conflicts or book rooms. Unsupported policy fields/actions require backend code and tests. No live evidence or student timing is established by scaffolding.\n`);
  const original = await readBounded(root, 'config/catalog.json', 24576), raw = JSON.parse(original.bytes);
  await loadCatalog({ root, config: OFFLINE_CONFIG, resolveCredentials: false });
  if (raw.tasks.some((t) => t.id === id || t.file.toLowerCase() === taskFile.toLowerCase())) throw new Error('Task ID/file already exists in catalog.');
  const entry = { id, file: taskFile }, prospective = structuredClone(raw);
  prospective.tasks.push(entry);
  if (register) {
    virtualFiles.set('config/catalog.json', json(prospective));
    await loadCatalog({ root, config: OFFLINE_CONFIG, virtualFiles, resolveCredentials: false });
  }
  return { mode: 'preview', files, tools: [...task.allowedTools], policy_ids: spec.task.proposal_policies?.map((p) => p.policy_id) || [],
    catalog_entry: entry, register, acceptance_status: 'NOT_RUN', task_fingerprint: task.fingerprint,
    catalog_hash: digest(original.bytes), catalog_ino: original.info.ino, catalog_dev: original.info.dev,
    catalog_before: original.bytes.toString('utf8'), catalog_after: json(prospective) };
}
