// Wires the pieces together and exposes the HTTP API. No framework: node:http
// is enough for this small API, and there is nothing extra to install on exam day.
//
//   GET  /api/health                              model + limits (never the key)
//   GET  /api/catalog                             safe task/profile metadata
//   POST /api/model-profiles/:id/probe  {}        bounded explicit probe
//   POST /api/runs                 {goal, task_id?, model_profile_id?}    start (202)
//   GET  /api/runs/:id                            poll a run
//   POST /api/runs/:id/approvals/:aid  {decision, args_hash}   approve / reject a write
//   POST /api/runs/:id/stop                       stop a run
//   GET  /api/drafts                              drafts written so far (read-only)

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AgentError } from './agent/runner.js';
import { createFileStore } from './store/fileStore.js';
import { buildCatalog } from '../config/catalog.config.js';
import { createRunManager } from './agent/runManager.js';
import { probeProfile } from './model/probe.js';

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/approval-outcome.js': ['approval-outcome.js', 'text/javascript; charset=utf-8'],
  '/workspace-view.js': ['workspace-view.js', 'text/javascript; charset=utf-8'],
  '/run-metrics.js': ['run-metrics.js', 'text/javascript; charset=utf-8'],
  '/configuration.js': ['configuration.js', 'text/javascript; charset=utf-8'],
  '/run-session.js': ['run-session.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/assets/robot-pet.png': ['assets/robot-pet.png', 'image/png'],
};
for (const weight of ['Regular', 'Medium', 'SemiBold', 'Bold']) {
  STATIC[`/assets/fonts/Poppins-${weight}.ttf`] = [`assets/fonts/Poppins-${weight}.ttf`, 'font/ttf'];
}
for (const icon of ['cpu-chip', 'squares-2x2', 'sparkles', 'document-text', 'chat-bubble-left-right', 'bolt', 'shield-check', 'play', 'stop', 'arrow-path', 'chevron-right', 'check-circle']) {
  STATIC[`/assets/icons/${icon}.svg`] = [`assets/icons/${icon}.svg`, 'image/svg+xml'];
}

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'",
  'referrer-policy': 'no-referrer',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...SECURITY_HEADERS });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

async function readJson(req, maxBytes) {
  if (!(req.headers['content-type'] || '').includes('application/json')) {
    throw new AgentError('unsupported_media_type', 'Send the body as application/json.', 415);
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new AgentError('body_too_large', `Request body exceeds ${maxBytes} bytes.`, 413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new AgentError('invalid_json', 'Body must be a JSON object.', 400);
  }
}

export async function createApp({ config, model, task, catalog, varDir, publicDir }) {
  if (!catalog) {
    if (!task?.fingerprint || !task?.dataDir || !task?.allowedTools?.length) throw new Error('Validated task config is required before server startup.');
    const modelConfig = model.runtimeConfig ?? { ...config.model, provider: model.isMock ? 'mock' : model.provider, name: model.name };
    catalog = await buildCatalog({ tasks: [task], profiles: [{ id: 'env', label: 'Environment model', config: modelConfig, model }], defaultTaskId: task.id, defaultProfileId: 'env' });
  }
  const store = await createFileStore({ root: varDir });
  const retriever = catalog.tasks.get(catalog.defaultTaskId)?.retriever;
  const runner = createRunManager({ catalog, store, limits: config.limits, modelTimeoutMs: config.model.timeoutMs });
  await runner.init();

  async function route(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean); // ['api','runs',id,...]

    if (req.method === 'GET' && STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname];
      return send(res, 200, await readFile(join(publicDir, file)), type);
    }
    if (parts[0] !== 'api') return send(res, 404, { error: 'not_found', message: 'Not found.' });

    if (req.method === 'GET' && url.pathname === '/api/catalog') return send(res, 200, catalog.metadata());
    if (req.method === 'POST' && parts[1] === 'model-profiles' && parts[2] && parts[3] === 'probe' && parts.length === 4) {
      const body = await readJson(req, config.server.maxBodyBytes);
      if (Object.keys(body).length) throw new AgentError('invalid_probe', 'Probe accepts an empty object only.');
      const profile = catalog.profiles.get(parts[2]);
      if (!profile) throw new AgentError('invalid_configuration', 'Select a registered model profile.');
      const probe = await probeProfile(profile);
      await store.appendAudit({ kind: 'model_probe', ...probe });
      return send(res, 200, { probe });
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      const profile = catalog.profiles.get(catalog.defaultProfileId).metadata;
      const taskMetadata = catalog.tasks.get(catalog.defaultTaskId).metadata;
      return send(res, 200, {
        ok: true,
        model: { provider: profile.provider, name: profile.name, is_mock: profile.is_mock },
        limits: { max_steps: config.limits.maxSteps, run_max_ms: config.limits.runMaxMs, max_goal_chars: config.limits.maxGoalChars, max_provider_requests: config.limits.maxProviderRequests, token_budget: config.limits.tokenBudget },
        retrieval: taskMetadata.data.retrieval,
        task: { id: taskMetadata.id, title: taskMetadata.title, allowed_tools: taskMetadata.allowed_tools, sample_inputs: taskMetadata.sample_inputs, result_labels: taskMetadata.result_labels },
      });
    }
    if (url.pathname === '/api/runs') {
      if (req.method === 'GET') return send(res, 200, { runs: runner.listRuns() });
      if (req.method === 'POST') {
        const body = await readJson(req, config.server.maxBodyBytes);
        if (Object.keys(body).some((key) => !['goal', 'task_id', 'model_profile_id'].includes(key))) throw new AgentError('invalid_configuration', 'Only goal and registered task/profile IDs may be submitted.');
        return send(res, 202, { run: await runner.startRun(body.goal, body) });
      }
    }
    if (parts[1] === 'runs' && parts[2]) {
      const runId = parts[2];
      if (req.method === 'GET' && parts.length === 3) return send(res, 200, { run: runner.getRun(runId) });
      if (req.method === 'POST' && parts[3] === 'stop' && parts.length === 4) return send(res, 200, { run: await runner.stopRun(runId) });
      if (req.method === 'POST' && parts[3] === 'approvals' && parts[4] && parts.length === 5) {
        const body = await readJson(req, config.server.maxBodyBytes);
        const result = await runner.decideApproval(runId, parts[4], body);
        return send(res, 200, result);
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/drafts') return send(res, 200, { drafts: await store.listDrafts() });
    return send(res, 404, { error: 'not_found', message: 'Unknown route.' });
  }

  const server = createServer((req, res) => {
    route(req, res).catch((err) => {
      if (err instanceof AgentError) return send(res, err.httpStatus, { error: err.code, message: err.message });
      console.error('[server] unexpected error:', err.message);
      send(res, 500, { error: 'internal_error', message: 'Unexpected server error.' });
    });
  });

  return { server, runner, store, retriever };
}
