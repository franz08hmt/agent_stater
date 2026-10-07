// Native Chrome DevTools protocol, isolated temporary profile, no dependencies.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function until(fn, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await delay(50); }
  throw new Error(`Browser QA timed out: ${label}`);
}
export async function browserQa() {
  const executable = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  if (!executable) throw new Error('Browser QA unavailable: set CHROME_PATH to a local Chromium browser.');
  const profile = await mkdtemp(join(tmpdir(), 'agent-config-browser-'));
  const artifacts = await mkdtemp(join(tmpdir(), 'agent-config-qa-'));
  const chrome = spawn(executable, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--disable-extensions', '--window-size=1280,960', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let socket;
  const port = await until(async () => { try { return Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); } catch { return null; } }, 'Chromium startup');
  const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0;
  const pending = new Map(), errors = [], responses = [];
  socket.addEventListener('message', ({ data }) => {
    const p = JSON.parse(data);
    if (p.method === 'Runtime.exceptionThrown') errors.push(p.params.exceptionDetails.text);
    if (p.method === 'Log.entryAdded' && p.params.entry.level === 'error') errors.push(p.params.entry.text);
    if (p.method === 'Network.responseReceived') responses.push(p.params.response);
    const e = pending.get(p.id); if (e) { pending.delete(p.id); p.error ? e.reject(new Error(p.error.message)) : e.resolve(p.result); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  for (const domain of ['Runtime', 'Log', 'Page', 'Network']) await send(`${domain}.enable`);
  const read = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`DOM evaluation failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  return { artifacts, errors, responses, read, send,
    async click(selector) {
      const point = await until(() => read(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if (!e || !e.getClientRects().length) return null; e.scrollIntoView({block:'center',behavior:'instant'}); const r=e.getBoundingClientRect(); return r.width && r.height ? {x:r.x+r.width/2,y:r.y+r.height/2} : null; })()`), `click ${selector}`);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
    },
    async screenshot(name, width = 1280) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 960, deviceScaleFactor: 1, mobile: width < 600 });
      const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      await writeFile(join(artifacts, `${name}-${width}.png`), Buffer.from(shot.data, 'base64'));
    },
    async close() {
      socket?.close(); chrome.kill();
      if (chrome.exitCode === null) await new Promise((r) => chrome.once('exit', r));
      const path = relative(tmpdir(), profile);
      if (!path.startsWith('agent-config-browser-') || path.startsWith('..')) throw new Error('Unsafe browser cleanup path');
      await rm(profile, { recursive: true, force: true });
    },
  };
}
