// "Questions and answers" board: every question asked in the Agent page with its answer, on one screen,
// updating while runs finish. Read-only: it only GETs stored runs. It never starts a run, never calls a model
// and never embeds anything; all text is written with textContent.
import { t, setLocale, readLocale, rememberLocale } from './i18n.js';
import { selectRuns, cardModel, runSignature } from './qa-board-model.js';
import { retrievalModel, renderCalls } from './retrieval-view.js';

const $ = (id) => document.getElementById(id);
const POLL_MS = 1500;
const STATUS = { running: 'Running', awaiting_approval: 'Awaiting approval', completed: 'Completed', failed: 'Failed', stopped: 'Stopped' };
const store = {
  get(key) { try { return window.localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { value === null ? window.localStorage.removeItem(key) : window.localStorage.setItem(key, value); } catch { /* the board still works without storage */ } },
};
const cutoffKey = (task) => `qa-board.since:${task}`;

let runs = [], tasks = [], failure = '';
const drawn = new Map(); // run id -> { signature, locale, node }

const el = (tag, text, className) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; };
const task = () => $('board-task').value;
const last = () => { const n = Number.parseInt($('board-last').value, 10); return Number.isInteger(n) && n >= 1 ? Math.min(n, 12) : 5; };

function applyStaticText() {
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-i18n-aria-label]')) node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel));
  document.documentElement.lang = $('board-locale').value;
}

async function showChunks(container, runId) {
  try {
    const { retrieval } = await (await fetch(`/api/runs/${encodeURIComponent(runId)}/retrieval`)).json();
    renderCalls(document, container, retrievalModel(retrieval));
  } catch { container.replaceChildren(el('p', t('Retrieved chunks unavailable'), 'hint')); }
}

function buildCard(run, number, previous) {
  const m = cardModel(run, number);
  const card = el('article', undefined, 'card');
  card.setAttribute('aria-labelledby', `q-${m.id}`);
  const head = el('div', undefined, 'card-head');
  head.append(el('span', `Q${m.number}`, 'num'), el('span', t(STATUS[m.status] ?? m.status), `status is-${m.status}`));
  if (m.seconds !== null && m.status !== 'running') head.append(el('span', `${m.seconds} s`));
  if (m.llmRequests !== null) head.append(el('span', `${m.llmRequests} ${t('model requests')}`));
  const question = el('h2', m.question, 'q'); question.id = `q-${m.id}`;
  card.append(head, el('p', t('Question'), 'label'), question);
  if (m.status === 'running' || m.status === 'awaiting_approval') card.append(el('p', t('Answering…'), 'hint'));
  if (m.answer) {
    card.append(el('p', t('Answer'), 'label'), el('p', m.answer, 'a'));
    card.append(el('p', t('Sources'), 'label'));
    const list = el('ul', undefined, 'sources');
    if (m.sources.length) for (const source of m.sources) list.append(el('li', source));
    else list.append(el('li', t('No source cited — read the unresolved explanation.')));
    card.append(list);
    if (m.gap) card.append(el('p', `${t('Not in the KB / gaps')}: ${m.gap}`, 'gap'));
  }
  if (m.failure) card.append(el('p', m.failure, 'failure'));
  if (m.hasChunks) {
    const details = el('details'); details.append(el('summary', t('Retrieved chunks')));
    const body = el('div'); details.append(body);
    let loaded = false;
    const load = () => { if (details.open && !loaded) { loaded = true; showChunks(body, m.id); } };
    details.addEventListener('toggle', load);
    if (previous?.open) { details.open = true; load(); }
    card.append(details);
  }
  return card;
}

function render() {
  const taskId = task();
  const since = store.get(cutoffKey(taskId));
  const chosen = selectRuns(runs, { task: taskId, last: last(), since });
  const locale = $('board-locale').value;
  const keep = new Set();
  chosen.forEach((run, index) => {
    keep.add(run.run_id);
    const signature = `${runSignature(run)}|${index}`;
    const old = drawn.get(run.run_id);
    if (old && old.signature === signature && old.locale === locale) return;
    const node = buildCard(run, index + 1, old?.node.querySelector('details'));
    old ? old.node.replaceWith(node) : $('board').append(node);
    drawn.set(run.run_id, { signature, locale, node });
  });
  for (const [id, entry] of drawn) if (!keep.has(id)) { entry.node.remove(); drawn.delete(id); }
  chosen.forEach((run) => $('board').append(drawn.get(run.run_id).node)); // keep the order they were asked in
  const title = tasks.find((x) => x.id === taskId)?.title ?? taskId;
  $('board-state').textContent = failure ? `${t('Could not read runs')}: ${failure}`
    : chosen.length ? `${chosen.length} ${t('question(s)')} · ${title}${since ? ` · ${t('since the last fresh start')}` : ''}`
      : `${t('No questions yet.')} ${t('Ask in the Agent page; answers appear here.')}`;
}

async function poll() {
  try {
    const res = await fetch('/api/runs');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    runs = (await res.json()).runs; failure = '';
  } catch (err) { failure = err.message; }
  render();
  setTimeout(poll, POLL_MS);
}

async function boot() {
  setLocale(readLocale(window.localStorage));
  $('board-locale').value = readLocale(window.localStorage);
  try {
    const catalog = await (await fetch('/api/catalog')).json();
    tasks = catalog.tasks;
    for (const item of tasks) { const option = el('option', item.title); option.value = item.id; $('board-task').append(option); }
    const saved = store.get('qa-board.task');
    $('board-task').value = tasks.some((x) => x.id === saved) ? saved : tasks.some((x) => x.id === 'sunrise-clinic-rag') ? 'sunrise-clinic-rag' : catalog.default_task_id;
  } catch (err) { failure = err.message; }
  const savedLast = Number.parseInt(store.get('qa-board.last') ?? '', 10);
  if (Number.isInteger(savedLast) && savedLast >= 1 && savedLast <= 12) $('board-last').value = String(savedLast);
  applyStaticText();
  $('board-task').addEventListener('change', () => { store.set('qa-board.task', task()); render(); });
  $('board-last').addEventListener('input', () => { store.set('qa-board.last', String(last())); render(); });
  $('board-locale').addEventListener('change', () => { rememberLocale(window.localStorage, $('board-locale').value); setLocale($('board-locale').value); applyStaticText(); drawn.clear(); $('board').replaceChildren(); render(); });
  $('board-fresh').addEventListener('click', () => {
    // Hide everything asked so far for this task: only questions created after the newest one are shown.
    const newest = runs.filter((r) => r.task_id === task()).map((r) => r.created_at).sort().at(-1);
    store.set(cutoffKey(task()), newest ?? new Date().toISOString()); render();
  });
  $('board-all').addEventListener('click', () => { store.set(cutoffKey(task()), null); render(); });
  poll();
}
boot();
