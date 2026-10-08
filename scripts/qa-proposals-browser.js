import assert from 'node:assert/strict';
import { browserQa, until } from './browserQa.js';
import { createProposalDemo } from './proposalDemoFixture.js';
import { PROPOSAL_CASES } from '../src/operations/proposalSuite.js';
const app = await createProposalDemo(), browser = await browserQa();
const { read, send, click } = browser;
const text = (id) => read(`document.getElementById(${JSON.stringify(id)}).textContent`);
const settled = (status) => until(async () => await text('status') === status, status);
const api = async (path, body) => (await fetch(app.url + path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const choose = (id, value) => read(`(() => {const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
try {
  await send('Page.navigate', { url: app.url });
  await until(() => read("!!document.querySelector('#task-select option[value=proposal-tickets]') && !document.getElementById('start').disabled"), 'catalog');
  for (const [index, caseId] of ['ticket-approve', 'room-approve', 'ticket-reject', 'ticket-approve', 'room-blocked'].entries()) {
    const c = PROPOSAL_CASES.find((c) => c.id === caseId); app.controls.caseId = caseId; app.controls.storeError = index === 3;
    await read("window.location.hash='#configuration'");
    if (index) await click('#new-run');
    await choose('task-select', c.taskId);
    await click('#goal'); await send('Input.insertText', { text: c.goal });
    assert.equal(await read("document.activeElement.id"), 'goal');
    await click('#start');
    if (index === 0) {
      await settled('Running'); await send('Page.reload'); await until(() => text('run-id'), 'restore running');
    }
    if (!c.blocked) {
      await settled('Awaiting approval'); const id = await text('run-id');
      if (index === 0) {
        const count = app.requests.length; await send('Page.reload'); await settled('Awaiting approval');
        assert.equal(await text('run-id'), id); assert.equal(app.requests.length, count, 'reload sends no model request');
        assert.match(await text('approval-summary'), /ticket_status/); assert.equal((await text('approval-hash')).length, 64);
      }
      const pending = (await api(`/api/runs/${id}`)).run.approvals.at(-1);
      await browser.screenshot(`proposal-pending-${index}`, index === 1 ? 390 : 1280);
      const selector = c.decision === 'reject' ? '#reject' : '#approve';
      if (index === 0) {
        await send('Page.bringToFront');
        await send('Emulation.setFocusEmulationEnabled', { enabled: true });
        await read("document.getElementById('approve').focus()");
        assert.equal(await read('document.activeElement.id'), 'approve');
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
      } else await click(selector);
      await settled('Completed');
      const replay = await api(`/api/runs/${id}/approvals/${pending.approval_id}`, { decision: c.decision, args_hash: pending.args_hash });
      assert.equal(replay.replayed, true);
      const saved = !app.controls.storeError && c.decision === 'approve';
      assert.match(await text('write-outcome'), saved ? /Proposal saved.*Changes not applied/ : /Proposal not saved/);
    } else { await settled('Completed'); assert.equal(await read("document.getElementById('approval').hidden"), true); }
    assert.equal(await read('document.documentElement.scrollWidth > window.innerWidth'), false, `overflow ${index}`);
  }
  assert.equal((await api('/api/proposals')).proposals.length, 2);
  await until(async () => (await text('proposals')).includes('class_room'), 'saved proposals visible');
  await send('Page.reload'); await settled('Completed'); assert.match(await text('proposals'), /Not applied/);
  await read("window.location.hash='#drafts-title'");
  await until(() => read("!!document.getElementById('proposals').getClientRects().length"), 'saved proposals panel visible');
  await browser.screenshot('proposal-completed', 390);
  assert.equal(browser.errors.length, 0, JSON.stringify(browser.errors));
  assert.equal(browser.responses.filter((r) => r.status >= 400).length, 0);
  console.log(JSON.stringify({ status: 'PASS', browser: 'Real isolated Chromium, fake HTTP provider', scenarios: 5,
    proposals: 2, requests: app.requests.length, artifacts: browser.artifacts, console_errors: browser.errors }, null, 2));
} finally { await browser.close(); await app.close(); }
