import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { PROJECT_ROOT, supportsNode, loadEnvironment } from '../src/operations/context.js';
import { inspectPort } from '../src/operations/launcher.js';
import { ROOT } from './helpers.js';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchForeground } from '../src/operations/launcher.js';

test('launcher root is script-owned and Node check uses the declared minimum', async () => {
  assert.equal(PROJECT_ROOT.toLowerCase(), ROOT.toLowerCase());
  assert.equal(supportsNode('22.12.0', '>=22.12.0'), true);
  assert.equal(supportsNode('22.11.9', '>=22.12.0'), false);
  assert.equal(supportsNode('24.0.0', '>=22.12.0'), true);
  const env = await loadEnvironment({ dotenv: false });
  assert.equal(env.catalog.defaultTaskId, 'study-notes'); assert.ok(env.service.project_id);
  assert.deepEqual(env.evidenceContext.limits, env.config.limits);
  assert.equal(env.evidenceContext.model_timeout_ms, env.config.model.timeoutMs);
  assert.equal(env.evidenceContext.profiles.find((p) => p.id === 'ollama-qwen3').timeout_ms, env.catalog.profiles.get('ollama-qwen3').config.timeoutMs);
});

async function server(t, handler) {
  const s = createServer(handler); await new Promise((r) => s.listen(0, '127.0.0.1', r));
  t.after(async () => { s.closeAllConnections(); await new Promise((r) => s.close(r)); }); return s;
}
test('empty port is available, foreign port is refused without killing its server', async (t) => {
  const s = await server(t, (_, res) => res.end('foreign app'));
  const port = s.address().port;
  assert.equal((await inspectPort({ host: '127.0.0.1', port }, { project_id: 'ours' })).state, 'occupied');
  assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'foreign app');
  await new Promise((r) => s.close(r));
  assert.equal((await inspectPort({ host: '127.0.0.1', port }, { project_id: 'ours' })).state, 'free');
});
test('only health plus catalog from the same project is reused; stale configuration is explicit', async (t) => {
  const service = { name: 'ai-agent-starter', project_id: 'ours', configuration_id: 'revision-1' };
  const s = await server(t, (req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.url === '/api/health' ? { ok: true, service } : { tasks: [], model_profiles: [] }));
  });
  const address = { host: '127.0.0.1', port: s.address().port };
  assert.equal((await inspectPort(address, service)).state, 'running');
  assert.equal((await inspectPort(address, service)).configuration_matches, true);
  assert.equal((await inspectPort(address, { ...service, project_id: 'other' })).state, 'occupied');
  assert.equal((await inspectPort(address, { ...service, configuration_id: 'revision-2' })).configuration_matches, false);
});

test('foreground launcher starts and verifies its own server from a temporary project root', { timeout: 20000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'agent-launch-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['src', 'config', 'data', 'package.json']) await cp(join(ROOT, name), join(root, name), { recursive: true });
  const s = await server(t, (_, res) => res.end('unused'));
  const port = s.address().port; await new Promise((r) => s.close(r));
  const env = await loadEnvironment({ root, dotenv: false }); env.config.server = { ...env.config.server, host: '127.0.0.1', port };
  const controller = new AbortController(), messages = [];
  const result = await launchForeground(env, { signal: controller.signal,
    childEnv: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    log(message) { messages.push(message); if (message.includes('Open this URL')) controller.abort(); },
  });
  assert.equal(result.state, 'exited'); assert.match(messages.join('\n'), /Open this URL.*Ctrl\+C/);
  assert.equal((await inspectPort(env.config.server, env.service)).state, 'free');
});
