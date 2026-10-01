// Browser side: only talks to our own backend. It holds no API key and cannot call
// any tool directly — approving a write is a request the backend checks again.

import { applyWorkspaceView } from './workspace-view.js';

const $ = (id) => document.getElementById(id);
const STATUS_TEXT = {
  running: 'Running',
  awaiting_approval: 'Awaiting approval',
  completed: 'Completed',
  failed: 'Failed',
  stopped: 'Stopped',
};
let current = null;
let pollTimer = null;

function updateCurrentNav(moveFocus = false) {
  const headingId = applyWorkspaceView(document, window.location.hash);
  if (moveFocus) {
    $(headingId).focus({ preventScroll: true });
    $('workspace').scrollIntoView({ block: 'start' });
  }
}
window.addEventListener('hashchange', () => updateCurrentNav(true));
updateCurrentNav();

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function showError(message) {
  for (const id of ['form-error', 'dialogue-error']) {
    $(id).textContent = message;
    $(id).hidden = !message;
  }
}

async function loadHealth() {
  try {
    const h = await api('/api/health');
    const badge = $('model-badge');
    badge.textContent = h.model.is_mock
      ? `Mock · ${h.model.name}`
      : `Live · ${h.model.name}`;
    badge.className = `badge ${h.model.is_mock ? 'is-mock' : 'is-live'}`;
    $('steps').dataset.max = h.limits.max_steps;
  } catch {
    $('model-badge').textContent = 'Backend unavailable';
  }
}

async function loadDrafts() {
  const { drafts } = await api('/api/drafts');
  const list = $('drafts');
  list.replaceChildren();
  if (!drafts.length) {
    const empty = el('li', 'No drafts yet. ', 'hint');
    const link = el('a', 'Open Agent');
    link.href = '#configuration';
    empty.append(link, ' to create one.');
    list.append(empty);
  }
  for (const d of drafts) {
    const li = el('li');
    li.append(el('strong', d.title), el('span', `Sources: ${d.source_ids.join(', ')} · ${d.draft_id}`, 'hint'));
    list.append(li);
  }
}

function render(run) {
  current = run;
  $('dialogue-empty').hidden = true;
  $('run-panel').hidden = false;
  $('run-panel').setAttribute('aria-busy', String(run.status === 'running'));
  $('goal-preview').textContent = run.goal;
  $('goal-preview').hidden = false;
  $('status').textContent = STATUS_TEXT[run.status] || run.status;
  $('status').className = `status is-${run.status}`;
  $('run-id').textContent = run.run_id;
  $('steps').textContent = `${run.steps_used} / ${$('steps').dataset.max || '?'}`;
  $('elapsed').textContent = `${(run.active_ms / 1000).toFixed(1)} s`;

  const busy = run.status === 'running' || run.status === 'awaiting_approval';
  $('start').disabled = busy;
  $('stop').hidden = !busy;
  $('stop-dialogue').hidden = !busy;
  $('new-run').hidden = busy;

  const pending = run.approvals.find((a) => a.approval_id === run.pending_approval);
  $('approval').hidden = !pending;
  if (pending) {
    $('approval-tool').textContent = pending.tool;
    $('approval-args').textContent = JSON.stringify(pending.arguments, null, 2);
    $('approval-hash').textContent = `${pending.args_hash.slice(0, 16)}…`;
  }

  $('result').hidden = !run.final;
  if (run.final) {
    $('answer').textContent = run.final.answer;
    $('unresolved').hidden = !run.final.unresolved;
  $('unresolved').textContent = run.final.unresolved ? `Unresolved: ${run.final.unresolved}` : '';
    const sources = $('sources');
    sources.replaceChildren();
    if (!run.final.source_ids.length) sources.append(el('li', 'No source cited — this answer is not grounded in a retrieved note.', 'hint'));
    for (const id of run.final.source_ids) sources.append(el('li', id));
  }

  $('failure').hidden = !run.failure;
  $('failure').textContent = run.failure ? `${run.failure.code}: ${run.failure.message}` : '';

  const body = $('trace');
  body.replaceChildren();
  for (const t of run.trace) {
    const tr = el('tr', undefined, `row-${t.status}`);
    tr.append(
      el('td', String(t.step)),
      el('td', t.kind),
      el('td', t.tool_name || ''),
      el('td', t.arguments ? JSON.stringify(t.arguments) : ''),
      el('td', t.status),
      el('td', t.duration_ms === undefined ? '' : String(t.duration_ms)),
      el('td', t.summary || ''),
    );
    body.append(tr);
  }
}

function schedulePoll() {
  clearTimeout(pollTimer);
  if (current?.status !== 'running') return;
  pollTimer = setTimeout(async () => {
    try {
      const { run } = await api(`/api/runs/${current.run_id}`);
      render(run);
      if (run.status !== 'running') loadDrafts();
    } catch (err) {
      showError(err.message);
    }
    schedulePoll();
  }, 600);
}

$('goal').addEventListener('input', () => { $('goal-count').textContent = $('goal').value.length; });

for (const b of document.querySelectorAll('.samples button')) {
  b.addEventListener('click', () => {
    $('goal').value = b.dataset.goal;
    $('goal-count').textContent = b.dataset.goal.length;
    $('goal').focus();
  });
}

$('goal-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('');
  try {
    const { run } = await api('/api/runs', { method: 'POST', body: JSON.stringify({ goal: $('goal').value }) });
    render(run);
    window.location.hash = '#dialogue';
    schedulePoll();
  } catch (err) {
    showError(err.message);
  }
});

async function decide(decision) {
  const pending = current.approvals.find((a) => a.approval_id === current.pending_approval);
  if (!pending) return;
  $('approve').disabled = true;
  $('reject').disabled = true;
  try {
    const { run } = await api(`/api/runs/${current.run_id}/approvals/${pending.approval_id}`, {
      method: 'POST',
      body: JSON.stringify({ decision, args_hash: pending.args_hash }),
    });
    render(run);
    loadDrafts();
    schedulePoll();
  } catch (err) {
    showError(err.message);
  } finally {
    $('approve').disabled = false;
    $('reject').disabled = false;
  }
}
$('approve').addEventListener('click', () => decide('approve'));
$('reject').addEventListener('click', () => decide('reject'));

async function stopRun() {
  if (!current) return;
  try { render((await api(`/api/runs/${current.run_id}/stop`, { method: 'POST' })).run); } catch (err) { showError(err.message); }
}
$('stop').addEventListener('click', stopRun);
$('stop-dialogue').addEventListener('click', stopRun);

$('new-run').addEventListener('click', () => {
  clearTimeout(pollTimer);
  current = null;
  $('run-panel').hidden = true;
  $('dialogue-empty').hidden = false;
  $('stop-dialogue').hidden = true;
  $('goal-preview').hidden = true;
  $('goal-preview').textContent = '';
  $('start').disabled = false;
  $('new-run').hidden = true;
  $('goal').value = '';
  $('goal-count').textContent = '0';
  showError('');
  $('goal').focus();
});

loadHealth();
loadDrafts();
