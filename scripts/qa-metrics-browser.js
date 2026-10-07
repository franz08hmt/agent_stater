// Real Chromium QA via its native DevTools protocol; no browser dependency/MCP.
// Uses isolated profiles, fake HTTP and temporary app storage, never a personal profile.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createBudgetDemo } from './budgetDemoFixture.js';

const executable = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
if (!executable) throw new Error('Browser QA unavailable: set CHROME_PATH to a local Chromium browser.');
const profile = await mkdtemp(join(tmpdir(), 'agent-metrics-browser-'));
const artifacts = await mkdtemp(join(tmpdir(), 'agent-metrics-qa-'));
const chrome = spawn(executable, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--disable-extensions', '--window-size=1280,960', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let port;
async function until(fn, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await delay(50); }
  throw new Error(`Browser QA timed out: ${label}`);
}
async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0;
  const pending = new Map(); const errors = [];
  socket.addEventListener('message', ({ data }) => {
    const packet = JSON.parse(data);
    if (packet.method === 'Runtime.exceptionThrown') errors.push(packet.params.exceptionDetails.text);
    if (packet.method === 'Log.entryAdded' && packet.params.entry.level === 'error') errors.push(packet.params.entry.text);
    const entry = pending.get(packet.id);
    if (entry) { pending.delete(packet.id); packet.error ? entry.reject(new Error(packet.error.message)) : entry.resolve(packet.result); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  return { send, errors, close: () => socket.close() };
}
try {
  port = await until(async () => { try { return Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); } catch { return null; } }, 'Chromium startup');
  for (const scenario of ['normal', 'budget', 'approval']) {
    const app = await createBudgetDemo({ requestLimit: scenario === 'budget' ? 1 : 12 });
    let cdp;
    try {
      const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
      cdp = await connect(tab.webSocketDebuggerUrl);
      const read = async (expression) => {
        const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
        if (result.exceptionDetails) throw new Error('DOM inspection failed');
        return result.result.value;
      };
      const click = async (selector) => {
        const point = await read(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({block:'center',behavior:'instant'}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
      };
      await cdp.send('Page.navigate', { url: `${app.url}/#configuration` });
      await until(() => read("document.querySelector('#model-badge')?.textContent.includes('fake-http-demo')"), 'UI ready');
      await click('#goal'); await cdp.send('Input.insertText', { text: scenario === 'approval' ? 'save HTTP 401 and 403' : 'Explain 401 and 403' });
      await click('#start');
      const expected = scenario === 'approval' ? 'Awaiting approval' : scenario === 'budget' ? 'Stopped' : 'Completed';
      await until(() => read(`document.querySelector('#status')?.textContent === ${JSON.stringify(expected)}`), expected);
      assert.match(await read("document.querySelector('#metrics-tokens').textContent"), /provider reported/);
      assert.match(await read("document.querySelector('#metrics-requests').textContent"), scenario === 'budget' ? /^1 \/ 1$/ : /^2 \/ 12$/);
      if (scenario === 'budget') {
        assert.match(await read("document.querySelector('#failure').textContent"), /request_budget.*exhausted/);
        assert.equal(app.requests(), 1); assert.equal((await app.store.listDrafts()).length, 0);
      }
      if (scenario === 'normal') assert.equal(await read("document.querySelector('#sources').textContent"), 'http-status');
      if (scenario === 'approval') {
        const before = await read("document.querySelector('#metrics-timing').textContent");
        await delay(750);
        await until(async () => (await read("document.querySelector('#metrics-timing').textContent")) !== before, 'live waiting time');
        assert.equal(app.requests(), 2);
        await click('#approve');
        await until(() => read("document.querySelector('#status').textContent === 'Completed'"), 'approval completion');
        assert.equal(app.requests(), 3); assert.equal((await app.store.listDrafts()).length, 1);
        assert.match(await read("document.querySelector('#metrics-requests').textContent"), /^3 \/ 12$/);
      }
      for (const width of [1280, 390]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 960, deviceScaleFactor: 1, mobile: width === 390 });
        assert.equal(await read('document.documentElement.scrollWidth <= window.innerWidth'), true, `no overflow at ${width}px`);
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        await writeFile(join(artifacts, `${scenario}-${width}.png`), Buffer.from(shot.data, 'base64'));
      }
      assert.deepEqual(cdp.errors, [], 'no browser runtime/network errors');
      console.log(`PASS real Chromium ${scenario}: requests=${app.requests()}, desktop/mobile metrics and alerts`);
      await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`);
    } finally { cdp?.close(); await app.close(); }
  }
  console.log(`Screenshots: ${artifacts}`);
} finally {
  chrome.kill();
  if (chrome.exitCode === null) await new Promise((resolve) => chrome.once('exit', resolve));
  const path = relative(tmpdir(), profile);
  if (!path.startsWith('agent-metrics-browser-') || path.startsWith('..')) throw new Error('Unsafe browser cleanup path');
  await rm(profile, { recursive: true, force: true });
}
