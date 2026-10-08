import { safePath, readBounded } from './files.js';
import { SPEC_MAX_BYTES } from './spec.js';
import { scaffoldProject } from './apply.js';
import { runAcceptanceTask } from './acceptance.js';
import { readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { supportsNode } from '../operations/context.js';

export function parseScaffoldOptions(args) {
  const result = { specFile: undefined, apply: false, register: false }, seen = new Set();
  for (const arg of args) {
    const key = arg.split('=')[0];
    if (seen.has(key)) throw new Error('Duplicate flag.'); seen.add(key);
    if (arg === '--apply') result.apply = true;
    else if (arg === '--register') result.register = true;
    else if (arg.startsWith('--spec=')) result.specFile = arg.slice(7);
    else throw new Error('Supported flags: --spec=templates/name.spec.json [--apply] [--register].');
  }
  if (!/^templates\/[A-Za-z0-9][A-Za-z0-9_.-]*\.json$/.test(result.specFile || '')
    || /\/(?:con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(result.specFile)) throw new Error('Spec must be a JSON file under project templates/.');
  return result;
}
async function checkNode(root) {
  // Trusted script-root file, never selected by a spec or model.
  const file = join(root, 'package.json'), info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 8192) throw new Error('Invalid package.json.');
  const bytes = await readFile(file);
  if (bytes.length > 8192) throw new Error('package.json exceeds size limit.');
  const pkg = JSON.parse(bytes);
  if (!supportsNode(process.versions.node, pkg.engines?.node)) throw new Error(`Node ${pkg.engines.node} required.`);
}
export async function scaffoldCli(root, args) {
  if (args.length === 1 && args[0] === '--help') { console.log('npm run exam:scaffold -- --spec=templates/name.spec.json [--apply] [--register]\nPreview by default. No LLM calls. Register only with an explicit flag.'); return; }
  const options = parseScaffoldOptions(args); await checkNode(root);
  await safePath(root, options.specFile);
  const spec = JSON.parse((await readBounded(root, options.specFile, SPEC_MAX_BYTES)).bytes);
  const result = await scaffoldProject({ root, spec, apply: options.apply, register: options.register });
  // Never print model profiles, credentials, full mission, data or private catalog bytes.
  const { mode, tools, policy_ids, catalog_entry, acceptance_status, task_fingerprint, registered, backup } = result;
  console.log(JSON.stringify({ mode, files: result.files.map(({ path, kind }) => ({ path, kind })), tools, policy_ids, catalog_entry,
    register_requested: options.register, registered: registered || false, backup, acceptance_status, task_fingerprint }, null, 2));
}
export async function acceptanceCli(root, args) {
  if (args.length !== 1 || !/^--task=[a-z][a-z0-9-]{0,39}$/.test(args[0])) throw new Error('Use npm run exam:acceptance -- --task=task-id.');
  await checkNode(root); const report = await runAcceptanceTask({ root, id: args[0].slice(7) });
  console.log(JSON.stringify(report, null, 2)); if (report.status !== 'PASS') process.exitCode = 1;
}
export function printScaffoldError(root, error) {
  console.error(JSON.stringify({ status: 'FAIL', error: String(error.message).replaceAll(root, '.').slice(0, 800),
    publication: error.publication, removed: error.removed, retained: error.retained, backup: error.backup }, null, 2));
  process.exitCode = 2;
}
