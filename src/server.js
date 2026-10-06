// Entry point: `npm start`. Loads .env (if present), builds the app, listens.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig } from '../config/agent.config.js';
import { loadTaskConfig } from '../config/task.config.js';
import { createModel } from './model/index.js';
import { createApp } from './app.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));

const config = loadConfig();
const task = await loadTaskConfig({ root });
const model = createModel(config.model);
const { server } = await createApp({
  config,
  model,
  task,
  varDir: join(root, 'var'),
  publicDir: join(root, 'public'),
});

server.listen(config.server.port, config.server.host, () => {
  const mode = model.isMock ? 'MOCK model (rule-based stand-in, NOT a real LLM)' : `${model.provider} · ${model.name}`;
  console.log(`AI agent starter on http://${config.server.host}:${config.server.port}`);
  console.log(`Model: ${mode}`);
  console.log(`Task: ${task.id} · ${task.allowedTools.join(', ')}`);
  if (!model.isMock && !config.model.apiKey) console.log('Note: MODEL_API_KEY is empty — fine for Ollama/vLLM, required for Gemini/OpenAI.');
});
