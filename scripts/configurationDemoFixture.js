// Fake provider + temporary storage for browser QA; no cloud or personal files.
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config/agent.config.js';
import { loadCatalog } from '../config/catalog.config.js';
import { createApp } from '../src/app.js';
import { createRuleBasedMock } from '../src/model/mock.js';

export async function createConfigurationDemo() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const dir = await mkdtemp(join(tmpdir(), 'agent-config-demo-'));
  const controls = { probe: 'ok', run: 'ok', delayMs: 650 }, requests = [];
  const mock = createRuleBasedMock();
  const provider = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw), isProbe = body.messages[0].content.startsWith('Connectivity probe');
    requests.push({ kind: isProbe ? 'probe' : 'run', body });
    if (!isProbe && controls.requestGate) await controls.requestGate;
    const mode = isProbe ? controls.probe : controls.run;
    if (mode === 'timeout') await new Promise((r) => setTimeout(r, 350));
    else if (!isProbe) await new Promise((r) => setTimeout(r, controls.delayMs));
    if (mode === '503' || mode === '429') { res.writeHead(Number(mode), { 'content-type': 'application/json' }); res.end('{"error":"simulated"}'); return; }
    const text = isProbe ? mode === 'invalid' ? '{"unexpected":true}' : '{"ok":true}'
      : body.messages[0].content.startsWith('Re-express ONLY') && controls.followupReply ? controls.followupReply
      : controls.runReply ? await controls.runReply(body.messages) : (await mock.complete({ messages: body.messages })).text;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: text } }], usage: mode === 'missing usage' ? null : { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
  });
  await new Promise((r) => provider.listen(0, '127.0.0.1', r));
  const config = loadConfig(); config.model.timeoutMs = 3000;
  const baseUrl = `http://127.0.0.1:${provider.address().port}/v1/`;
  // Reuse the real validated catalog tasks; explicit fake profiles replace its providers.
  const original = await loadCatalog({ root, config });
  const { buildCatalog } = await import('../config/catalog.config.js');
  const catalog = await buildCatalog({ tasks: [...original.tasks.values()].map((e) => e.task), profiles: [
    { id: 'mock', label: 'Offline mock', config: { ...config.model, provider: 'mock' } },
    { id: 'http', label: 'Fake HTTP', config: { ...config.model, provider: 'openai-compatible', name: 'fake-config-http', baseUrl, apiKey: '' } },
    { id: 'missing', label: 'Missing credential', config: { ...config.model, provider: 'openai-compatible', name: 'fake-cloud', baseUrl, apiKey: '' }, requiresKey: true },
  ], defaultTaskId: 'study-notes', defaultProfileId: 'mock' });
  const app = await createApp({ config, catalog, varDir: dir, publicDir: join(root, 'public') });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  return { ...app, config, catalog, controls, requests, url: `http://127.0.0.1:${app.server.address().port}`,
    async close() {
      for (const run of app.runner.listRuns()) if (['running', 'awaiting_approval'].includes(run.status)) { await app.runner.stopRun(run.run_id); await app.runner.idle(run.run_id); }
      for (const server of [app.server, provider]) { server.closeAllConnections(); await new Promise((r) => server.close(r)); }
      if (!dir.startsWith(join(tmpdir(), 'agent-config-demo-'))) throw new Error('Unsafe temporary cleanup');
      await rm(dir, { recursive: true, force: true });
    },
  };
}
