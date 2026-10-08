import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createConfigurationDemo } from './configurationDemoFixture.js';
import { browserQa, until } from './browserQa.js';

const app = await createConfigurationDemo(), b = await browserQa();
const { read, send, click } = b;
const text = (id) => read(`document.getElementById(${JSON.stringify(id)}).textContent`);
const choose = async (id, value) => { await read(`(() => {const e=document.getElementById(${JSON.stringify(id)}); e.value=${JSON.stringify(value)}; e.dispatchEvent(new Event('change',{bubbles:true}));})()`); };
const status = (value) => until(async () => (await text('status')) === value, value);
const uiReady = () => until(() => read("!!document.querySelector('#task-select option[value=study-notes]') && !document.querySelector('#model-select').disabled"), 'configuration ready');
const api = async (path, body) => {
  const r = await fetch(app.url + path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
};
const viewed = async () => (await api(`/api/runs/${await text('run-id')}`)).run;
const navigateConfig = async () => { await read("window.location.hash='#configuration'"); await delay(70); };
const reset = async () => { await navigateConfig(); await click('#new-run'); await choose('model-select', 'http'); };
const start = async (goal) => {
  await navigateConfig(); await click('#goal'); await send('Input.insertText', { text: goal }); await click('#start');
};
const reload = async () => { await send('Page.reload'); await until(() => read("document.querySelector('#run-panel')?.hidden === false"), 'reload restored run'); };
try {
  // A note title is untrusted metadata: it must stay literal text, never HTML.
  app.catalog.tasks.get('study-notes').metadata.data.notes[0].title = '<img id="qa-injected-image" src=x onerror="globalThis.qaInjected=true">';
  await send('Page.navigate', { url: `${app.url}/#configuration` }); await uiReady();
  await choose('ui-locale', 'en');
  assert.equal(app.requests.length, 0, 'load never probes');
  assert.match(await text('task-tools'), /search_notes.*save_draft/s); assert.match(await text('task-data'), /http-status/);
  assert.ok((await text('task-data')).includes('<img id="qa-injected-image"'));
  assert.equal(await read("!!document.querySelector('#qa-injected-image') || globalThis.qaInjected === true"), false);
  for (const [task, dataset, count, column] of [['rehearsal-tickets', 'tickets', 6, 'hours'], ['rehearsal-rooms', 'rooms', 5, 'capacity']]) {
    await choose('task-select', task);
    assert.match(await text('task-tools'), /query_dataset/); assert.ok(!(await text('task-tools')).includes('save_draft'));
    assert.ok((await text('task-data')).includes(`${dataset}: ${count} records`)); assert.ok((await text('task-data')).includes(column));
    assert.ok((await read("document.querySelector('.samples').textContent")).trim().length > 0);
  }
  assert.equal(app.requests.length, 0, 'new rehearsal metadata never calls a model');
  await choose('task-select', 'datasets-demo');
  assert.match(await text('task-tools'), /query_dataset/); assert.ok(!(await text('task-tools')).includes('save_draft'));
  assert.match(await text('task-data'), /products: 4 records.*classes: 4 records/s);
  assert.match(await read("document.querySelector('.samples').textContent"), /Product sum.*Class count.*Group comparison/s);
  for (const width of [1280, 390]) { await b.screenshot('dataset-configuration', width); assert.equal(await read('document.documentElement.scrollWidth <= innerWidth'), true); }
  await click('#probe-model'); await until(async () => (await text('probe-result')).includes('Mock simulation'), 'mock probe');
  assert.equal(app.requests.length, 0); assert.match(await text('probe-result'), /no real LLM connection/);
  await click('.samples button'); await click('#start'); await status('Completed');
  assert.equal(await text('answer'), 'Total = 30.30'); assert.match(await text('sources'), /^ds-products-/);
  const dataset = await viewed(); await reload(); await status('Completed'); assert.equal(app.requests.length, 0);
  await navigateConfig(); await choose('task-select', 'study-notes'); await choose('model-select', 'http');
  assert.match(await text('run-configuration'), /Fictional Products.*Mock/s);
  assert.equal(await text('sources-title'), 'Dataset sources', 'next selection never relabels historical result');
  await choose('model-select', 'missing');
  assert.match(await text('configuration-status'), /unavailable.*credential/);
  assert.equal(await read("document.querySelector('#start').disabled && document.querySelector('#probe-model').disabled"), true);
  assert.equal(app.requests.length, 0);
  await choose('model-select', 'http');
  console.log('PASS catalog: task/tools/data/examples, mock/live/unavailable, historical selection, offline dataset');

  await read("document.querySelector('#task-select').focus()");
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  assert.equal(await read('document.activeElement.id'), 'model-select', 'keyboard access to labeled selectors');
  for (const id of ['task-select', 'model-select']) assert.equal(await read(`!!document.querySelector('label[for="${id}"]')`), true);

  await reset(); await delay(100);
  assert.equal(await read('location.hash'), '#configuration'); assert.equal(await read('document.activeElement.id'), 'goal');
  await start('save HTTP 401 and 403'); await status('Running');
  const runId = await text('run-id');
  assert.equal(await read("document.querySelector('#task-select').disabled && document.querySelector('#model-select').disabled"), true);
  await reload(); await status('Awaiting approval');
  assert.equal(await text('run-id'), runId); assert.equal(app.requests.filter((r) => r.kind === 'run').length, 2);
  const pending = await viewed(), a = pending.approvals.at(-1);
  assert.match(await text('approval-args'), /HTTP/); assert.ok((await text('approval-hash')).startsWith(a.args_hash.slice(0, 16)));
  await reload(); await status('Awaiting approval'); await delay(750);
  assert.equal(app.requests.length, 2, 'reload/polling pending never calls model or writes');
  assert.equal((await app.store.listDrafts()).length, 0);
  assert.deepEqual(await read('Object.keys(localStorage).sort()'), ['agent-studio.ui-locale', 'agent-studio.viewed-run']);
  assert.equal(await read("localStorage.getItem('agent-studio.viewed-run')"), runId);
  for (const width of [1280, 390]) {
    await b.screenshot('pending', width);
    assert.equal(await read('document.documentElement.scrollWidth <= innerWidth'), true, `no overflow ${width}`);
    await read("document.querySelector('#approve').scrollIntoView({block:'center',behavior:'instant'})");
    assert.equal(await read("(() => {let r=document.querySelector('#approve').getBoundingClientRect(); return r.width>0 && r.left>=0 && r.right<=innerWidth;})()"), true);
  }
  await click('#approve'); await status('Completed');
  assert.equal((await app.store.listDrafts()).length, 1); assert.equal(app.requests.length, 3);
  const complete = await viewed(), replay = await api(`/api/runs/${runId}/approvals/${a.approval_id}`, { decision: 'approve', args_hash: a.args_hash });
  assert.equal(replay.replayed, true); assert.deepEqual(replay.run.metrics, complete.metrics);
  await reload(); await status('Completed'); assert.equal(app.requests.length, 3);
  console.log('PASS reload: running/pending/completed, immutable configuration, approval/replay and single write, desktop/mobile');

  await reset(); await start('save HTTP 401 and 403'); await status('Awaiting approval');
  const rejected = await viewed(), ra = rejected.approvals.at(-1);
  await click('#reject'); await status('Completed'); assert.equal((await app.store.listDrafts()).length, 1);
  const count = app.requests.length;
  assert.equal((await api(`/api/runs/${rejected.run_id}/approvals/${ra.approval_id}`, { decision: 'reject', args_hash: ra.args_hash })).replayed, true);
  assert.equal(app.requests.length, count);
  console.log('PASS approval rejection/replay: no new draft or request');

  await navigateConfig();
  for (const scenario of ['ok', 'missing usage', 'invalid', '503', '429', 'timeout']) {
    app.controls.probe = scenario; app.catalog.profiles.get('http').config.timeoutMs = 120;
    const before = app.requests.length; await click('#probe-model');
    await until(() => read("document.querySelector('#model-check').getAttribute('aria-busy') === 'false'"), `probe ${scenario}`);
    assert.equal(app.requests.length, before + 1, `probe ${scenario} has no retry`);
    const expected = { ok: 'protocol valid', 'missing usage': 'usage unavailable', invalid: 'protocol was invalid', '503': 'unavailable', '429': 'rate_limited', timeout: 'timed out' }[scenario];
    assert.ok((await text('probe-result')).includes(expected), `${scenario}: ${await text('probe-result')}`);
  }
  app.controls.probe = 'timeout'; await click('#probe-model');
  assert.equal(await read("document.querySelector('#model-check').getAttribute('aria-busy')"), 'true');
  assert.equal(await read("document.querySelector('#start').disabled && document.querySelector('#model-select').disabled"), true);
  await until(() => read("document.querySelector('#model-check').getAttribute('aria-busy') === 'false'"), 'probe loading state');
  console.log('PASS explicit probe: success/protocol failure/503/429/timeout/missing usage, one HTTP per click, separate accounting/loading');

  await reset();
  app.controls.run = '429'; await start('Explain HTTP 401 and 403'); await status('Failed');
  assert.match(await text('failure'), /model_rate_limited/); const failedCount = app.requests.length;
  await reload(); await status('Failed'); assert.equal(app.requests.length, failedCount);
  app.controls.run = 'ok'; app.config.limits.maxProviderRequests = 1;
  await reset(); await start('Explain HTTP 401 and 403'); await status('Stopped');
  assert.match(await text('failure'), /request_budget/); assert.equal(await text('metrics-requests'), '1 / 1');
  const budgetCount = app.requests.length; await reload(); await status('Stopped'); assert.equal(app.requests.length, budgetCount);
  await b.screenshot('budget', 390);
  console.log('PASS reload failed/budget stop: preserved error/metrics, no extra requests');

  const beforeMissing = app.requests.length;
  await read("localStorage.setItem('agent-studio.viewed-run','../bad')"); await send('Page.reload'); await uiReady();
  assert.match(await text('form-error'), /invalid/); assert.equal(app.requests.length, beforeMissing);
  await read("localStorage.setItem('agent-studio.viewed-run','run_missing')"); await send('Page.reload'); await uiReady();
  await until(async () => (await text('form-error')).includes('Could not restore'), 'missing run message');
  assert.equal(await read("localStorage.getItem('agent-studio.viewed-run')"), null);
  assert.equal(app.requests.length, beforeMissing); assert.equal((await app.store.listDrafts()).length, 1);
  // One deliberate GET 404 verifies the missing-run state. All other browser requests succeed.
  assert.deepEqual(b.responses.filter((r) => r.status >= 400).map((r) => [new URL(r.url).pathname, r.status]), [['/api/runs/run_missing', 404]]);
  assert.deepEqual(b.errors.filter((e) => !e.includes('404')), []);
  await navigateConfig();
  for (const width of [1280, 390]) { await b.screenshot('configuration', width); assert.equal(await read('document.documentElement.scrollWidth <= innerWidth'), true); }
  assert.equal(dataset.metrics.provider_requests, 0);
  console.log(`PASS invalid/missing storage recovery and safe browser network. Evidence: ${b.artifacts}`);
  console.log(`QA accounting: ${app.requests.filter((r) => r.kind === 'probe').length} fake probe HTTP; ${app.requests.filter((r) => r.kind === 'run').length} fake run HTTP; zero cloud.`);
} finally { await b.close(); await app.close(); }
