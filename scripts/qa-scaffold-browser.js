// Full spec -> files -> catalog -> acceptance -> existing UI, isolated and offline.
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserQa, until } from './browserQa.js';
import { scaffoldProject } from '../src/scaffold/apply.js';
import { runAcceptanceTask, acceptanceDecision } from '../src/scaffold/acceptance.js';
import { OFFLINE_CONFIG } from '../src/scaffold/spec.js';
import { loadCatalog } from '../config/catalog.config.js';
import { createApp } from '../src/app.js';
import { createScriptedModel } from '../src/model/mock.js';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url)), root = await mkdtemp(join(tmpdir(), 'scaffold-browser-project-'));
let app, browser, calls = 0; const offline = [], specs = [];
try {
  for (const folder of ['config', 'data']) await cp(join(sourceRoot, folder), join(root, folder), { recursive: true });
  for (const template of ['dataset-read', 'proposal']) {
    const spec = JSON.parse(await readFile(join(sourceRoot, 'templates', `${template}.spec.json`))); specs.push(spec);
    const plan = await scaffoldProject({ root, spec, register: true }); assert.equal(plan.mode, 'preview');
    await scaffoldProject({ root, spec, apply: true, register: true });
    const report = await runAcceptanceTask({ root, id: spec.task.id }); assert.equal(report.status, 'PASS', JSON.stringify(report.results));
    offline.push({ task: spec.task.id, cases: report.results.length, status: report.status, provider_requests: report.provider_requests });
  }
  const catalog = await loadCatalog({ root, config: OFFLINE_CONFIG, resolveCredentials: false });
  let active = specs[0].cases[0], task = catalog.tasks.get(specs[0].task.id).task;
  const base = createScriptedModel([(messages) => acceptanceDecision(active, messages, task.datasets)]);
  catalog.profiles.get('mock').model = { ...base, async complete(args) { calls++; await new Promise((r) => setTimeout(r, 120)); return base.complete(args); } };
  app = await createApp({ config: { ...OFFLINE_CONFIG, server: { maxBodyBytes: 16000 } }, catalog, publicDir: join(sourceRoot, 'public'), varDir: join(root, 'var') });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  browser = await browserQa(); const { read, send, click } = browser;
  const choose = (id, value) => read(`(() => { const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await send('Page.navigate', { url });
  await until(() => read("!!document.querySelector('#task-select option[value=exam-class-proposal]') && !document.getElementById('start').disabled"), 'generated catalog');
  for (const [index, spec] of specs.entries()) {
    await read("window.location.hash='#configuration'");
    if (index) await click('#new-run');
    await choose('task-select', spec.task.id); await choose('model-select', 'mock');
    const entry = catalog.tasks.get(spec.task.id);
    assert.deepEqual(entry.metadata.allowed_tools, spec.task.allowed_tools);
    assert.equal(await read("document.getElementById('profile-title').textContent"), spec.task.title);
    const dataText = await read("document.getElementById('task-data').textContent");
    for (const d of entry.task.datasets) assert.ok(dataText.includes(d.idColumn));
    assert.equal(await read("document.querySelector('.samples button').dataset.goal"), spec.task.sample_inputs[0].goal);
    if (!await read("document.querySelector('.configuration-details').open")) await click('.configuration-details summary');
    assert.equal(await read("!!document.getElementById('task-tools').getClientRects().length"), true);
    await send('Page.bringToFront'); await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await read("document.getElementById('task-select').focus()"); assert.equal(await read('document.activeElement.id'), 'task-select');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    assert.notEqual(await read('document.activeElement.id'), 'task-select');
    for (const width of [1280, 390]) {
      await browser.screenshot(`scaffold-${spec.template}`, width);
      assert.equal(await read('document.documentElement.scrollWidth > window.innerWidth'), false);
    }
    task = entry.task; active = spec.cases[0];
    await click('#goal'); await send('Input.insertText', { text: active.goal }); await click('#start');
    if (spec.template === 'proposal') {
      await until(() => read("document.getElementById('status').textContent === 'Awaiting approval'"), 'proposal approval');
      const previousCalls = calls; await send('Page.reload');
      await until(() => read("document.getElementById('status').textContent === 'Awaiting approval'"), 'restore pending');
      assert.equal(calls, previousCalls); assert.match(await read("document.getElementById('approval-summary').textContent"), /class_room/);
      await click('#approve');
    }
    await until(() => read("document.getElementById('status').textContent === 'Completed'"), 'completed generated task');
    assert.equal(await read("document.getElementById('answer').textContent"), spec.template === 'proposal' ? 'Proposal saved; changes not applied.' : active.answer);
  }
  assert.equal((await app.store.listProposals()).length, 1);
  assert.ok(await task.verifyCurrent());
  assert.equal(browser.errors.length, 0, JSON.stringify(browser.errors));
  assert.equal(browser.responses.filter((r) => r.status >= 400).length, 0);
  console.log(JSON.stringify({ status: 'PASS', browser: 'Real isolated Chromium', offline, generated_task_ui: 2, scripted_model_calls: calls,
    provider_requests: 0, live_evidence: 'NOT_RUN', student_timing: 'NOT_RUN', console_errors: browser.errors, artifacts: browser.artifacts }, null, 2));
} finally {
  await browser?.close();
  if (app) {
    for (const run of app.runner.listRuns()) if (['running', 'awaiting_approval'].includes(run.status)) await app.runner.stopRun(run.run_id);
    app.server.closeAllConnections(); await new Promise((r) => app.server.close(r));
  }
  if (!root.startsWith(join(tmpdir(), 'scaffold-browser-project-'))) throw new Error('Unsafe cleanup');
  await rm(root, { recursive: true, force: true });
}
