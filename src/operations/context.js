import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../../config/agent.config.js';
import { loadCatalog } from '../../config/catalog.config.js';

export const PROJECT_ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
export const hash = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
// Direct grader dependencies outside the src/config runtime tree are explicit.
// File names participate in the hash; stable ordering avoids filesystem order.
const GRADER_FILES = ['eval/cases.json', 'eval/checks.js', 'eval/run-eval.js', 'eval/sunrise-acceptance.json', 'src/operations/cases.js', 'src/operations/suite.js',
  'scripts/exam-campaign.js', 'templates/rehearsal-rentals.spec.json', 'scripts/verify-adaptation.js', 'templates/asset-loan.spec.json'].sort();
export function supportsNode(version, range) {
  if (!/^>=\d+\.\d+\.\d+$/.test(range)) throw new Error('Unsupported package Node engine range.');
  const current = version.replace(/^v/, '').split('.').map(Number), min = range.slice(2).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (current[i] !== min[i]) return current[i] > min[i]; }
  return true;
}
export function configurationIdentity(catalog, config, protocolIdentity = '') {
  return hash({ defaults: [catalog.defaultTaskId, catalog.defaultProfileId],
    tasks: [...catalog.tasks.values()].map((e) => [e.task.id, e.task.fingerprint]),
    profiles: [...catalog.profiles.values()].map((e) => [e.id, e.identity, e.metadata.status]),
    limits: config.limits, timeout: config.model.timeoutMs, protocol: protocolIdentity });
}

// Hash the backend/config module tree, including new modules, rather than a
// hand-picked protocol subset. Documentation and Git commit IDs are not runtime.
async function runtimeIdentity(root, nodeEngine) {
  async function modules(directory) {
    const files = [];
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error('Runtime fingerprint requires regular project files, not symlinks.');
      if (entry.isDirectory()) files.push(...await modules(relative));
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(relative);
    }
    return files;
  }
  const files = [...await modules('src'), ...await modules('config')].sort();
  return hash({ node_engine: nodeEngine, modules: await Promise.all(files.map(async (file) => [file, hash(await readFile(join(root, file), 'utf8'))])) });
}
export async function loadEnvironment({ root = PROJECT_ROOT, dotenv = true } = {}) {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (!supportsNode(process.versions.node, pkg.engines.node)) throw new Error(`Node ${pkg.engines.node} required; current ${process.versions.node}.`);
  if (dotenv && existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
  const config = loadConfig(), catalog = await loadCatalog({ root, config });
  const protocol = await runtimeIdentity(root, pkg.engines.node);
  const service = { name: pkg.name, project_id: hash(root.toLowerCase()), configuration_id: configurationIdentity(catalog, config, protocol) };
  let commit = 'unknown', dirty = null;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }).trim().split('\n').some((line) => line && !line.slice(3).startsWith('.agents/'));
  } catch { /* Git is optional at operation time. */ }
  const suiteIdentity = hash(await Promise.all(GRADER_FILES.map(async (file) => [file, hash(await readFile(join(root, file), 'utf8'))])));
  const evidenceContext = { commit, working_tree_modified: dirty, configuration_id: service.configuration_id, protocol_identity: protocol, runtime_identity: protocol, suite_identity: suiteIdentity,
    environment: { node: process.versions.node, platform: process.platform, port: config.server.port }, limits: { ...config.limits }, model_timeout_ms: config.model.timeoutMs,
    tasks: [...catalog.tasks.values()].map(({ task }) => ({ id: task.id, fingerprint: task.fingerprint,
      datasets: task.datasets.map((d) => ({ id: d.id, version: d.version, records: d.rows.length })) })),
    profiles: [...catalog.profiles.values()].map((p) => ({ ...p.metadata, identity: p.identity, output_cap: p.config.maxOutputTokens, reasoning: p.config.reasoningEffort || 'default',
      temperature: p.config.temperature, json_mode: p.config.jsonMode, timeout_ms: p.config.timeoutMs })),
  };
  return { root, config, catalog, service, evidenceContext };
}
