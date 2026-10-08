import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config/agent.config.js';
import { loadCatalog, buildCatalog } from '../config/catalog.config.js';
import { createApp } from '../src/app.js';
import { PROPOSAL_CASES, scriptedProposalDecision } from '../src/operations/proposalSuite.js';
export async function createProposalDemo() {
  const root = fileURLToPath(new URL('../', import.meta.url)), dir = await mkdtemp(join(tmpdir(), 'proposal-browser-demo-'));
  const config = loadConfig(); config.model.timeoutMs = 3000;
  const original = await loadCatalog({ root, config });
  const controls = { caseId: 'ticket-approve', storeError: false }, requests = [];
  const provider = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk; const body = JSON.parse(raw); requests.push(body);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const c = PROPOSAL_CASES.find((c) => c.id === controls.caseId);
    const decision = scriptedProposalDecision(c, body.messages, original.tasks.get(c.taskId).task.datasets);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(decision) } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const catalog = await buildCatalog({ tasks: [...original.tasks.values()].map((e) => e.task),
    profiles: [{ id: 'fake', label: 'Fake HTTP proposal QA', config: { ...config.model, provider: 'openai-compatible', name: 'fake-proposal-http',
      baseUrl: `http://127.0.0.1:${provider.address().port}/v1/`, apiKey: '' } }], defaultTaskId: 'proposal-tickets', defaultProfileId: 'fake' });
  const app = await createApp({ config, catalog, varDir: dir, publicDir: join(root, 'public') });
  const save = app.store.createProposalOnce;
  app.store.createProposalOnce = (...args) => controls.storeError ? Promise.reject(Object.assign(new Error('Fixture storage unavailable.'), { writeOutcome: 'not_saved' })) : save(...args);
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  return { ...app, controls, requests, url: `http://127.0.0.1:${app.server.address().port}`, async close() {
    for (const run of app.runner.listRuns()) if (['running', 'awaiting_approval'].includes(run.status)) await app.runner.stopRun(run.run_id);
    for (const s of [app.server, provider]) { s.closeAllConnections(); await new Promise((resolve) => s.close(resolve)); }
    if (!dir.startsWith(join(tmpdir(), 'proposal-browser-demo-'))) throw new Error('Unsafe cleanup'); await rm(dir, { recursive: true, force: true });
  } };
}
