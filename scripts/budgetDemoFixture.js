// Fake HTTP provider + isolated app storage. No .env, cloud or existing var/.
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config/agent.config.js';
import { loadTaskConfig } from '../config/task.config.js';
import { createOpenAICompatibleModel } from '../src/model/openaiCompatible.js';
import { createApp } from '../src/app.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export async function createBudgetDemo({ requestLimit = 12 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'agent-budget-demo-'));
  let requests = 0;
  const provider = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    requests++;
    const { messages } = JSON.parse(raw);
    const observations = messages.filter((m) => m.content.startsWith('OBSERVATION'));
    const save = messages.some((m) => m.content.startsWith('GOAL:') && m.content.includes('save'));
    const decision = !observations.length
      ? { type: 'tool_call', tool: 'search_notes', arguments: { query: '401 403' } }
      : save && observations.length === 1
        ? { type: 'tool_call', tool: 'save_draft', arguments: { title: 'HTTP status', content: '401 authentication; 403 authorization.', source_ids: ['http-status'] } }
        : { type: 'final', answer: '401 authentication; 403 authorization.', source_ids: ['http-status'], unresolved: '' };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(decision) } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const config = loadConfig();
  config.limits.maxProviderRequests = requestLimit;
  config.limits.tokenBudget = 100000;
  const model = createOpenAICompatibleModel({ ...config.model, name: 'fake-http-demo', baseUrl: `http://127.0.0.1:${provider.address().port}/v1/`, apiKey: '', maxOutputTokens: 800 });
  const task = await loadTaskConfig({ root });
  const app = await createApp({ config, model, task, varDir: dir, publicDir: join(root, 'public') });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  return { ...app, url: `http://127.0.0.1:${app.server.address().port}`, requests: () => requests,
    async close() {
      for (const server of [app.server, provider]) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
      const path = relative(tmpdir(), dir);
      if (path.startsWith('..') || !path.startsWith('agent-budget-demo-')) throw new Error('Unsafe temporary cleanup path');
      await rm(dir, { recursive: true, force: true });
    },
  };
}
