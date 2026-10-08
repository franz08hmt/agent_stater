// Real Chromium; isolated stores/profiles and fake HTTP only. Screenshots are exact viewports.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { browserQa, until } from './browserQa.js';
import { createConfigurationDemo } from './configurationDemoFixture.js';
import { createProposalDemo } from './proposalDemoFixture.js';
import { createBudgetDemo } from './budgetDemoFixture.js';
import { PROPOSAL_CASES } from '../src/operations/proposalSuite.js';

const browser = await browserQa(), { read, send, click } = browser;
const measurements = [], results = [], accounting = [];
const text = (id) => read(`document.getElementById(${JSON.stringify(id)}).textContent`);
async function settled(status) {
  try { return await until(async () => await text('status') === status, status); }
  catch (error) {
    console.error(JSON.stringify({ expected: status, actual: await text('status'), failure: await text('failure'), form_error: await text('form-error'),
      selection: await read("({task:document.getElementById('task-select').value,model:document.getElementById('model-select').value})") }));
    throw error;
  }
}
const choose = (id, value) => read(`(() => {const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
const api = async (app, path, body) => (await fetch(app.url + path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
async function viewport(width = 1366, height = 768) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
}
async function open(app) {
  await viewport(); await send('Page.navigate', { url: `${app.url}/#configuration` });
  await until(() => read(`location.origin===${JSON.stringify(app.url)} && !!document.getElementById('task-select') && !document.getElementById('task-select').disabled`), 'configuration');
  await read('document.fonts.ready');
  await choose('ui-locale', 'en');
}
async function reload(status) {
  const marker = await read('window.qaDocumentMarker=crypto.randomUUID()');
  await send('Page.reload');
  await until(async () => {
    try { return await read(`document.readyState==='complete' && window.qaDocumentMarker!==${JSON.stringify(marker)} && !!document.getElementById('run-panel') && !document.getElementById('run-panel').hidden`); }
    catch { return false; }
  }, 'new document restored its run');
  await settled(status);
}
async function exam() {
  if (await read("document.documentElement.dataset.mode!=='exam'")) await click('#exam-mode');
  await read("window.scrollTo({top:0,behavior:'instant'})");
}
async function assertLayout(label, selectors) {
  await read("window.scrollTo({top:0,behavior:'instant'})");
  const rects = await read(`(${JSON.stringify(selectors)}).map(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return {selector:s,x:r.x,y:r.y,width:r.width,height:r.height,visible:!!e.getClientRects().length,within:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth}})`);
  measurements.push({ label, width: await read('innerWidth'), height: await read('innerHeight'), rects });
  for (const r of rects) assert.equal(r.visible && r.within, true, `${label}: ${r.selector} must fit viewport ${JSON.stringify(r)}`);
  assert.equal(await read('document.documentElement.scrollWidth<=innerWidth'), true, `${label}: no horizontal overflow`);
}
async function start(goal) {
  await read(`document.getElementById('goal').value=${JSON.stringify(goal)};document.getElementById('goal').dispatchEvent(new Event('input',{bubbles:true}))`);
  await click('#start');
}
async function screenshot(name, width = 1366, height = 768) { await browser.screenshot(name, width, { height, fullPage: false }); }
async function runId() { return text('run-id'); }
async function newRun() { await click('#new-run'); }
try {
  const app = await createConfigurationDemo();
  try {
    await open(app);
    assert.equal(await read('document.documentElement.dataset.mode'), 'standard');
    await screenshot('standard-before-exam');
    await exam();
    assert.equal(await read("document.getElementById('exam-mode').getAttribute('aria-pressed')"), 'true');
    assert.equal(await read("document.getElementById('configuration').hidden||document.getElementById('dialogue').hidden"), false);
    assert.equal(await read("document.querySelectorAll('#goal-form').length"), 1);
    assert.equal(await read("(()=>{const ids=[...document.querySelectorAll('[id]')].map(e=>e.id);return ids.length===new Set(ids).size})()"), true, 'unique IDs');
    assert.equal(await read("document.getElementById('app-header').getAttribute('aria-labelledby')"), 'exam-title');
    await assertLayout('notes input 1366', ['#task-select', '#model-select', '#goal', '#start']);
    await screenshot('exam-notes'); await screenshot('exam-wide', 1920, 1080);
    await viewport();
    await click('a[href="#agent-profile"]');
    await until(() => read("document.activeElement.id==='configuration-title'"), 'Exam Overview focuses visible configuration heading');
    assert.equal(await read("document.querySelector('a[href=\"#agent-profile\"]').getAttribute('aria-current')"), 'location');
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await send('Page.bringToFront'); await read("document.getElementById('task-select').focus()");
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    assert.equal(await read('document.activeElement.id'), 'model-select');
    await choose('model-select', 'missing'); assert.equal(await read("document.getElementById('start').disabled"), true);
    assert.match(await text('configuration-status'), /unavailable/); assert.match(await text('mode-context'), /unavailable/);
    await choose('task-select', 'datasets-demo'); await choose('model-select', 'mock');
    assert.match(await text('task-tools'), /query_dataset/); assert.match(await text('task-data'), /products/);
    await click('.configuration-details summary');
    await click('.samples button'); assert.ok(await read("document.getElementById('goal').value.length>0"));
    await click('.configuration-details summary');
    await start(await read("document.getElementById('goal').value")); await settled('Completed');
    assert.match(await text('metrics-requests'), /Mock, no HTTP/); assert.match(await text('sources'), /^ds/);
    assert.equal(app.requests.length, 0); await newRun();
    await choose('task-select', 'study-notes'); await choose('model-select', 'http');
    app.controls.probe = 'missing usage'; await click('#probe-model');
    await until(async () => (await text('probe-summary')).includes('Probe protocol valid'), 'explicit probe');
    assert.match(await text('probe-result'), /usage unavailable/); assert.equal(app.requests.length, 1);
    app.controls.probe = '503'; await click('#probe-model');
    await until(() => read("document.getElementById('model-check').getAttribute('aria-busy')==='false'"), 'failed probe');
    assert.equal(app.requests.length, 2); assert.doesNotMatch(await text('probe-summary'), /Probe protocol valid/);
    let release; app.controls.requestGate = new Promise(r => { release = r; });
    try {
      await start('Explain HTTP 401 and 403');
      await until(() => app.requests.some(r => r.kind === 'run'), 'request in flight');
      const before = app.requests.length, id = await runId();
      await click('#exam-mode'); await click('#exam-mode');
      await reload('Running');
      assert.equal(await runId(), id); assert.equal(app.requests.length, before);
      assert.equal(await read('document.documentElement.dataset.mode'), 'exam');
    } finally { release(); app.controls.requestGate = null; }
    await settled('Completed'); assert.match(await text('sources'), /http-status/);
    assert.match(await text('metrics-breakdown'), /Provider reported input/);
    const completedRequests = app.requests.length;
    await click('#exam-mode'); await click('#exam-mode'); await reload('Completed');
    assert.equal(app.requests.length, completedRequests); await newRun();
    await start('save HTTP 401 and 403'); await settled('Awaiting approval');
    const pendingRequests = app.requests.length;
    await click('#approval-details summary'); await read("document.getElementById('reject').focus()");
    await click('.configuration-details summary');
    await read("window.qaSampleNode=document.querySelector('.samples button');document.getElementById('reject').focus()");
    const scroll = await read('scrollY');
    const snapshot = await text('approval-args');
    await new Promise(r => setTimeout(r, 750));
    assert.equal(await read('document.activeElement.id'), 'reject');
    assert.equal(await read('scrollY'), scroll, 'polling does not scroll');
    assert.equal(await read("document.querySelector('.configuration-details').open&&window.qaSampleNode.isConnected"), true, 'polling preserves configuration details and sample nodes');
    assert.equal(await read("document.getElementById('approval-details').open"), true);
    assert.equal(await text('approval-args'), snapshot);
    await click('#exam-mode'); await click('#exam-mode'); await reload('Awaiting approval');
    assert.equal(app.requests.length, pendingRequests); assert.equal((await app.store.listDrafts()).length, 0);
    await assertLayout('draft approval 1366', ['#goal', '#start', '#approve', '#reject']);
    await click('#reject'); await settled('Completed'); assert.match(await text('write-outcome'), /rejected/i);
    assert.equal((await app.store.listDrafts()).length, 0); await newRun();
    assert.equal(await read("localStorage.getItem('agent-studio.ui-mode')"), 'exam');
    await choose('model-select', 'http');
    app.controls.run = '429'; await start('Explain HTTP 401 and 403'); await settled('Failed');
    assert.match(await text('failure'), /rate_limit|429/); await reload('Failed');
    assert.match(await text('mode-context'), /failed/);
    assert.deepEqual(await read('Object.keys(localStorage).sort()'), ['agent-studio.ui-locale', 'agent-studio.ui-mode', 'agent-studio.viewed-run']);
    for (const width of [390, 320, 900]) {
      await viewport(width, 844); assert.equal(await read('document.documentElement.scrollWidth<=innerWidth'), true, `${width}px overflow`);
      assert.equal(await read("document.getElementById('configuration').hidden||document.getElementById('dialogue').hidden"), false);
      if (width === 390) { await read("window.scrollTo({top:0,behavior:'instant'})"); await screenshot('exam-mobile', width, 844); }
    }
    accounting.push({ fixture: 'configuration', requests: app.requests.length, probes: app.requests.filter(r => r.kind === 'probe').length });
    results.push('configuration, keyboard, notes/dataset, unavailable, explicit probes, running/pending/completed/failed reload, mode preference and draft reject');
  } finally { await app.close(); }

  const proposals = await createProposalDemo();
  try {
    await open(proposals); await exam();
    for (const [i, caseId] of ['room-approve', 'ticket-reject', 'ticket-approve'].entries()) {
      if (i) await newRun();
      const c = PROPOSAL_CASES.find(c => c.id === caseId); proposals.controls.caseId = caseId;
      if (i === 2) proposals.store.createProposalOnce = async () => { throw Object.assign(new Error('Fixture publication state unknown.'), { writeOutcome: 'unknown' }); };
      await choose('task-select', c.taskId); await start(c.goal); await settled('Awaiting approval');
      const id = await runId(), pending = (await api(proposals, `/api/runs/${id}`)).run.approvals.at(-1);
      const before = proposals.requests.length;
      assert.deepEqual(JSON.parse(await text('approval-args')), pending.arguments);
      assert.match(await text('approval-summary'), /snapshot/); assert.equal(await text('approval-hash'), pending.args_hash);
      await assertLayout(`${caseId} approval 1366`, ['#approve', '#reject']);
      if (!i) {
        await screenshot('exam-room-approval');
        await screenshot('exam-room-wide', 1920, 1080); await viewport(390, 844);
        await read("document.getElementById('approval').scrollIntoView({block:'start',behavior:'instant'})");
        await screenshot('exam-room-mobile', 390, 844);
        assert.equal(await read('document.documentElement.scrollWidth<=innerWidth'), true);
        await viewport();
      }
      await click('#exam-mode'); await click('#exam-mode'); await reload('Awaiting approval');
      assert.equal(proposals.requests.length, before); assert.equal(await runId(), id);
      await click(c.decision === 'reject' ? '#reject' : '#approve'); await settled('Completed');
      const replayCount = proposals.requests.length;
      const replay = await api(proposals, `/api/runs/${id}/approvals/${pending.approval_id}`, { decision: c.decision, args_hash: pending.args_hash });
      assert.equal(replay.replayed, true); assert.equal(proposals.requests.length, replayCount);
      assert.match(await text('write-outcome'), i === 2 ? /outcome unknown/i : i === 1 ? /not saved/i : /saved.*not applied/i);
      if (i === 2) { assert.doesNotMatch(await text('write-outcome'), /Proposal saved/); await screenshot('exam-unknown-outcome'); }
    }
    assert.equal((await proposals.store.listProposals()).length, 1);
    await read("window.location.hash='#drafts-title'");
    await until(() => read("!!document.getElementById('proposals').getClientRects().length"), 'saved view');
    assert.match(await text('proposals'), /Not applied/);
    assert.equal(await read("document.getElementById('configuration').hidden&&document.getElementById('dialogue').hidden"), true);
    assert.equal(await read("document.querySelector('a[href=\"#drafts-title\"]').getAttribute('aria-current')"), 'location');
    accounting.push({ fixture: 'proposals', requests: proposals.requests.length });
    results.push('room approval, ticket reject, unknown write outcome, replay, snapshots/hash, saved Not applied and semantic navigation');
  } finally { await proposals.close(); }

  const budget = await createBudgetDemo({ requestLimit: 1 });
  try {
    await open(budget); await exam(); await start('Explain HTTP 401 and 403'); await settled('Stopped');
    assert.match(await text('failure'), /request_budget/); assert.equal(budget.requests(), 1);
    const id = await runId(); await click('#exam-mode'); await click('#exam-mode'); await reload('Stopped');
    assert.equal(await runId(), id); assert.equal(budget.requests(), 1);
    await screenshot('exam-budget-stop');
    accounting.push({ fixture: 'budget', requests: budget.requests() }); results.push('budget stop and saved stopped reload');
  } finally { await budget.close(); }
  assert.deepEqual(browser.errors, [], 'console/runtime errors');
  assert.deepEqual(browser.responses.filter(r => r.status >= 400).map(r => ({ url: r.url, status: r.status })), [], 'network errors');
  const report = { status: 'PASS', browser: 'Real isolated Chromium', results, measurements, accounting,
    real_llm_requests: 0, fullscreen: 'NOT_RUN — not implemented', screenshots: browser.artifacts };
  await writeFile(join(browser.artifacts, 'exam-qa.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await writeFile(join(browser.artifacts, 'exam-qa.json'), JSON.stringify({ status: 'FAIL', error: error.message, results, measurements, accounting, console_errors: browser.errors }, null, 2));
  console.error(`Failed QA evidence: ${browser.artifacts}`); throw error;
} finally { await browser.close(); }
