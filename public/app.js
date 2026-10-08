// Browser side: only talks to our own backend. It holds no API key and cannot call
// any tool directly — approving a write is a request the backend checks again.

import { applyWorkspaceView } from './workspace-view.js';
import { latestWriteOutcome } from './approval-outcome.js';
import { formatRunMetrics } from './run-metrics.js';
import { setupConfiguration } from './configuration.js';
import { readRunSession, rememberRun } from './run-session.js';
import { setupExamMode, modeContext } from './exam-mode.js';
import { approvalRows } from './approval-presentation.js';
import { t, setupLocale, currentLocale, errorExplanation } from './i18n.js';

const $ = (id) => document.getElementById(id);
const setText = (id, value) => { if ($(id).textContent !== value) $(id).textContent = value; };
const STATUS_TEXT = {
  running: 'Running',
  awaiting_approval: 'Awaiting approval',
  completed: 'Completed',
  failed: 'Failed',
  stopped: 'Stopped',
};
let current = null;
let pollTimer = null;
let configuration = null, ready = false, restoring = true, creating = false;
let selection = null, approvalSignature = null;
let draftsCache = [], proposalsCache = [];
const storage = { getItem: (key) => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value), removeItem: (key) => window.localStorage.removeItem(key) };

function updateCurrentNav(moveFocus = false) {
  const headingId = applyWorkspaceView(document, window.location.hash, document.documentElement.dataset.mode);
  if (moveFocus) {
    $(headingId).focus({ preventScroll: true });
    $('workspace').scrollIntoView({ block: 'start' });
  }
}
window.addEventListener('hashchange', () => updateCurrentNav(true));
updateCurrentNav();
setupExamMode(document, storage, () => updateCurrentNav());
const updateContext = () => { $('mode-context').textContent = modeContext(current, selection); };
setupLocale(document, storage, () => {
  configuration?.refresh(); updateContext();
  $('mode-state').textContent = t(document.documentElement.dataset.mode === 'exam' ? 'Exam' : 'Standard');
  if (current) render(current);
  renderDrafts(); renderProposals();
});

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || `HTTP ${res.status}`), { code: data.error });
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

async function loadDrafts() {
  const { drafts } = await api('/api/drafts');
  draftsCache = drafts; renderDrafts();
}
function renderDrafts() {
  const drafts = draftsCache;
  const list = $('drafts');
  list.replaceChildren();
  if (!drafts.length) {
    const empty = el('li', t('No drafts yet. '), 'hint');
    const link = el('a', t('Open Agent'));
    link.href = '#configuration';
    empty.append(link, t(' to create one.'));
    list.append(empty);
  }
  for (const d of drafts) {
    const li = el('li');
    li.append(el('strong', d.title), el('span', `${t('Sources')}: ${d.source_ids.join(', ')} · ${d.draft_id}`, 'hint'));
    list.append(li);
  }
}

async function loadProposals() {
  const list = $('proposals'); $('proposals-error').hidden = true;
  try {
    const { proposals } = await api('/api/proposals?limit=20'); proposalsCache = proposals; renderProposals();
  } catch (err) { $('proposals-error').hidden = false; $('proposals-error').textContent = `${t('Proposals unavailable')}: ${err.message}`; }
}
function renderProposals() {
    const list = $('proposals'), proposals = proposalsCache; list.replaceChildren();
    if (!proposals.length) list.append(el('li', t('No proposals yet.'), 'hint'));
    for (const p of proposals) {
      const li = el('li');
      li.append(el('strong', p.action), el('span', `${t('Changes')}: ${JSON.stringify(p.changes)}`), el('span', p.reason));
      for (const r of p.references) li.append(el('span', `${r.role}: ${r.dataset_id} / ${r.record_id} · ${r.source_id} · snapshot ${r.dataset_version}`, 'hint'));
      li.append(el('span', `${p.proposal_id} · ${p.created_at} · ${t('Not applied')}`, 'hint')); list.append(li);
    }
}

function render(run) {
  if (current?.run_id !== run.run_id) {
    $('goal').value = run.goal;
    $('goal-count').textContent = run.goal.length;
  }
  current = run;
  updateContext();
  rememberRun(storage, run.run_id);
  configuration?.setRun(run);
  const labels = run.configuration?.task.result_labels ?? { answer: 'Answer', sources: 'Sources', unresolved: 'Unresolved' };
  $('result-title').textContent = labels.answer === 'Answer' ? t('Answer') : labels.answer; $('sources-title').textContent = labels.sources === 'Sources' ? t('Sources') : labels.sources;
  $('run-configuration').textContent = `${t('This run')}: ${run.configuration?.task.title ?? run.task_id ?? t('Legacy task')} · ${run.configuration?.model_profile.label ?? t('Legacy model')} · ${run.model ? `${t(run.model.is_mock ? 'Mock' : 'Live')} ${run.model.name}` : t('Model not recorded')}`;
  $('dialogue-empty').hidden = true;
  $('run-panel').hidden = false;
  $('run-panel').setAttribute('aria-busy', String(run.status === 'running'));
  $('goal-preview').textContent = run.goal;
  $('goal-preview').hidden = false;
  setText('status', t(STATUS_TEXT[run.status] || run.status));
  $('status').className = `status is-${run.status}`;
  $('run-id').textContent = run.run_id;
  $('steps').textContent = `${run.steps_used} / ${run.configuration?.limits.max_steps ?? $('steps').dataset.max ?? '?'}`;
  $('elapsed').textContent = `${(run.active_ms / 1000).toFixed(1)} s`;
  const metrics = formatRunMetrics(run.metrics);
  for (const key of ['requests', 'tokens', 'calls', 'timing', 'note', 'breakdown']) $(`metrics-${key}`).textContent = metrics[key];

  const busy = run.status === 'running' || run.status === 'awaiting_approval';
  $('goal').disabled = busy;
  $('start').disabled = busy || !ready || restoring || creating;
  $('stop').hidden = !busy;
  $('stop-dialogue').hidden = !busy;
  $('new-run').hidden = busy;

  const pending = run.approvals.find((a) => a.approval_id === run.pending_approval);
  $('approval').hidden = !pending;
  const signature = pending ? `${pending.approval_id}:${pending.args_hash}:${currentLocale()}` : null;
  if (pending && signature !== approvalSignature) {
    $('approval-tool').textContent = pending.tool;
    $('approval-args').textContent = JSON.stringify(pending.arguments, null, 2);
    $('approval-hash').textContent = pending.args_hash;
    $('approval-hash').title = pending.args_hash;
    $('approval-summary').replaceChildren();
    const summary = $('approval-summary'), list = el('dl');
    for (const [label, value] of approvalRows(pending, run.configuration?.task)) {
      const row = el('div'); row.append(el('dt', t(label)), el('dd', value)); list.append(row);
    }
    summary.append(list);
    if (pending.result_kind === 'proposal') summary.append(el('p', t('Internal proposal only; changes are not applied.'), 'hint'));
  }
  approvalSignature = signature;

  const writeOutcome = latestWriteOutcome(run.approvals);
  $('write-outcome').hidden = !writeOutcome;
  setText('write-outcome', t(writeOutcome?.message || ''));
  $('write-outcome').className = `write-outcome ${writeOutcome?.status || ''}`;

  $('result').hidden = !run.final;
  if (run.final) {
    $('answer').textContent = run.final.answer;
    $('unresolved').hidden = !run.final.unresolved;
    $('unresolved').textContent = run.final.unresolved ? `${labels.unresolved}: ${run.final.unresolved}` : '';
    const sources = $('sources');
    sources.replaceChildren();
    if (!run.final.source_ids.length) sources.append(el('li', t('No source cited — read the unresolved explanation.'), 'hint'));
    for (const id of run.final.source_ids) sources.append(el('li', id));
  }

  $('failure').hidden = !run.failure;
  $('failure').textContent = run.failure ? `${run.failure.code}: ${errorExplanation(run.failure.code)} ${run.failure.message}` : '';

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
  if (!['running', 'awaiting_approval'].includes(current?.status)) return;
  pollTimer = setTimeout(async () => {
    const runId = current?.run_id;
    if (!runId) return;
    try {
      const { run } = await api(`/api/runs/${runId}`);
      if (current?.run_id !== runId) return;
      render(run);
      if (!['running', 'awaiting_approval'].includes(run.status)) { loadDrafts().catch((err) => showError(err.message)); loadProposals(); }
    } catch (err) {
      showError(err.message);
    }
    schedulePoll();
  }, 600);
}

$('goal').addEventListener('input', () => { $('goal-count').textContent = $('goal').value.length; });

document.querySelector('.samples').addEventListener('click', (event) => {
  const b = event.target.closest('button[data-goal]');
  if (b) {
    $('goal').value = b.dataset.goal;
    $('goal-count').textContent = b.dataset.goal.length;
    $('goal').focus();
  }
});

$('goal-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!configuration || !ready || creating || restoring || ['running', 'awaiting_approval'].includes(current?.status)) return;
  creating = true; $('start').disabled = true;
  showError('');
  try {
    const { run } = await api('/api/runs', { method: 'POST', body: JSON.stringify({ goal: $('goal').value, ...configuration.selected() }) });
    render(run);
    window.location.hash = '#dialogue';
    schedulePoll();
  } catch (err) {
    showError(err.message);
  } finally { creating = false; configuration.refresh(); }
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
    loadDrafts().catch((err) => showError(err.message));
    loadProposals();
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
  approvalSignature = null;
  rememberRun(storage, null);
  configuration?.setRun(null);
  $('run-panel').hidden = true;
  $('dialogue-empty').hidden = false;
  $('stop-dialogue').hidden = true;
  $('goal-preview').hidden = true;
  $('goal-preview').textContent = '';
  $('start').disabled = !ready;
  $('new-run').hidden = true;
  $('goal').value = '';
  $('goal').disabled = false;
  $('goal-count').textContent = '0';
  showError('');
  window.location.hash = '#configuration';
  $('goal').focus();
  updateContext();
});

async function boot() {
  try {
    const health = await api('/api/health'); $('steps').dataset.max = health.limits.max_steps;
    configuration = await setupConfiguration(api, ({ ready: configured, task, profile }) => {
      selection = { task, profile }; updateContext();
      ready = configured; $('start').disabled = !ready || restoring || creating || ['running', 'awaiting_approval'].includes(current?.status);
    });
    const saved = readRunSession(storage);
    if (saved.invalid) showError(t('Saved run ID is invalid. You can start a new run.'));
    if (saved.id) {
      try {
        const { run } = await api(`/api/runs/${saved.id}`); render(run);
        window.location.hash = '#dialogue'; schedulePoll();
      } catch (err) {
        if (err.code === 'run_not_found') rememberRun(storage, null);
        showError(`${t('Could not restore the viewed run')}: ${err.message}. ${t('You can start a new run.')}`);
      }
    }
    await loadDrafts();
    await loadProposals();
  } catch (err) {
    $('model-badge').textContent = t('Backend unavailable'); showError(err.message);
  } finally { restoring = false; configuration?.refresh(); }
}
boot();
