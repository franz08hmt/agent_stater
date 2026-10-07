import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../../config/agent.config.js';
import { loadCatalog } from '../../config/catalog.config.js';

export const PROJECT_ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
export const hash = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
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
export async function loadEnvironment({ root = PROJECT_ROOT, dotenv = true } = {}) {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (!supportsNode(process.versions.node, pkg.engines.node)) throw new Error(`Node ${pkg.engines.node} required; current ${process.versions.node}.`);
  if (dotenv && existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
  const config = loadConfig(), catalog = await loadCatalog({ root, config });
  const protocol = hash((await Promise.all(['config/prompts.js', 'src/agent/runner.js', 'src/tools/queryDataset.js', 'src/model/openaiCompatible.js', 'src/model/probe.js']
    .map((file) => readFile(join(root, file), 'utf8')))).join('\n'));
  const service = { name: pkg.name, project_id: hash(root.toLowerCase()), configuration_id: configurationIdentity(catalog, config, protocol) };
  let commit = 'unknown', dirty = null;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }).trim().split('\n').some((line) => line && !line.slice(3).startsWith('.agents/'));
  } catch { /* Git is optional at operation time. */ }
  const suiteIdentity = hash((await Promise.all(['src/operations/cases.js', 'src/operations/suite.js'].map((f) => existsSync(join(root, f)) ? readFile(join(root, f), 'utf8') : 'not-added'))).join('\n'));
  const evidenceContext = { commit, working_tree_modified: dirty, configuration_id: service.configuration_id, protocol_identity: protocol, suite_identity: suiteIdentity,
    environment: { node: process.versions.node, platform: process.platform, port: config.server.port },
    tasks: [...catalog.tasks.values()].map(({ task }) => ({ id: task.id, fingerprint: task.fingerprint,
      datasets: task.datasets.map((d) => ({ id: d.id, version: d.version, records: d.rows.length })) })),
    profiles: [...catalog.profiles.values()].map((p) => ({ ...p.metadata, identity: p.identity, output_cap: p.config.maxOutputTokens, reasoning: p.config.reasoningEffort || 'default' })),
  };
  return { root, config, catalog, service, evidenceContext };
}
