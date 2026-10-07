// Entry point: `npm start`. Loads .env (if present), builds the app, listens.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig } from '../config/agent.config.js';
import { createApp } from './app.js';
import { loadCatalog } from '../config/catalog.config.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));

const config = loadConfig();
const catalog = await loadCatalog({ root, config });
const profile = catalog.profiles.get(catalog.defaultProfileId);
const task = catalog.tasks.get(catalog.defaultTaskId).task;
const { server } = await createApp({
  config,
  catalog,
  varDir: join(root, 'var'),
  publicDir: join(root, 'public'),
});

server.listen(config.server.port, config.server.host, () => {
  const model = profile.metadata;
  const mode = model.is_mock ? 'MOCK model (rule-based stand-in, NOT a real LLM)' : `${model.provider} · ${model.name} (${model.status})`;
  console.log(`AI agent starter on http://${config.server.host}:${config.server.port}`);
  console.log(`Model: ${mode}`);
  console.log(`Task: ${task.id} · ${task.allowedTools.join(', ')}`);
  if (profile.metadata.status === 'unavailable') console.log(`Model profile unavailable: ${profile.metadata.reason}`);
});
