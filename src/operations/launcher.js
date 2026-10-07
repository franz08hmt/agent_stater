import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export function serverUrl({ host, port }) {
  const h = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '[::1]' : host.includes(':') ? `[${host}]` : host;
  return `http://${h}:${port}`;
}
async function readStatus(url) {
  const responses = await Promise.all(['/api/health', '/api/catalog'].map(async (path) => {
    const res = await fetch(url + path, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) throw new Error('No project API'); return res.json();
  }));
  return { health: responses[0], catalog: responses[1] };
}
export async function inspectPort(address, service) {
  const url = serverUrl(address), socket = createServer();
  const free = await new Promise((resolve, reject) => {
    socket.once('error', (err) => err.code === 'EADDRINUSE' ? resolve(false) : reject(err));
    socket.listen({ ...address, exclusive: true }, () => socket.close(() => resolve(true)));
  });
  if (free) return { state: 'free', url };
  try {
    const { health, catalog } = await readStatus(url);
    if (health.ok === true && health.service?.name === 'ai-agent-starter' && health.service.project_id === service.project_id
      && Array.isArray(catalog.tasks) && Array.isArray(catalog.model_profiles)) {
      return { state: 'running', url, configuration_matches: health.service.configuration_id === service.configuration_id };
    }
  } catch { /* The owner may be non-HTTP or a different app. Never kill it. */ }
  return { state: 'occupied', url };
}
export async function launchForeground(env, { log = console.log, signal, childEnv = process.env } = {}) {
  const state = await inspectPort(env.config.server, env.service);
  if (state.state === 'occupied') throw new Error('Configured port has an unverified owner (another app or an older server without project identity). Stop it yourself; no process was killed.');
  if (state.state === 'running') {
    log(`Server running: ${state.url} (reused; stop it in its original terminal).`);
    if (!state.configuration_matches) log('Configuration is stale. Restart the original server before using the new task/profile.');
    return state;
  }
  if (signal?.aborted) throw new Error('Startup cancelled.');
  const child = spawn(process.execPath, [join(env.root, 'src/server.js')], { cwd: env.root, env: childEnv, stdio: 'inherit', windowsHide: true });
  let exited = false, spawnError;
  const exit = new Promise((resolve) => { child.once('exit', (code) => { exited = true; resolve(code); }); child.once('error', (err) => { spawnError = err; exited = true; resolve(1); }); });
  const stop = () => { if (!exited) child.kill('SIGINT'); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  signal?.addEventListener('abort', stop, { once: true });
  try {
    const deadline = Date.now() + 15000;
    let ready = false;
    while (Date.now() < deadline && !exited) {
      try { const { health, catalog } = await readStatus(state.url); ready = health.service?.project_id === env.service.project_id
        && health.service.configuration_id === env.service.configuration_id && Array.isArray(catalog.tasks); } catch { /* startup in progress */ }
      if (ready) break; await delay(150);
    }
    if (!ready) { stop(); throw new Error(spawnError ? 'Could not start Node server.' : 'Server failed health/catalog startup verification.'); }
    log(`Server running: ${state.url}. Open this URL in your browser. Ctrl+C stops this launcher-owned server.`);
    log('Model profiles are configured only; no LLM request or live acceptance test has run during startup.');
    const code = await exit;
    return { state: 'exited', exit_code: code ?? 0, url: state.url };
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); signal?.removeEventListener('abort', stop); }
}
