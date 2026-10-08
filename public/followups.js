import { t, errorExplanation } from './i18n.js';
import { formatRunMetrics } from './run-metrics.js';

export function setupFollowups(api, document) {
  const $ = (id) => document.getElementById(id);
  let id = null, ledger = null, busy = false, timer;
  function render() {
    $('followup-panel').hidden = !id;
    $('followup-send').disabled = busy || !ledger || ledger.results.length >= 3;
    $('followup-form').setAttribute('aria-busy', String(busy));
    const list = $('followup-results'); list.replaceChildren();
    for (const result of ledger?.results || []) {
      const li = document.createElement('li'), text = document.createElement('p'), state = document.createElement('span');
      state.textContent = `${result.status}: ${result.request}`;
      text.textContent = result.answer || (result.error ? `${result.error.code}: ${errorExplanation(result.error.code)} ${result.error.message}` : t('Rephrasing…'));
      li.append(state, text);
      if (result.status === 'REVIEW_REQUIRED') { const note = document.createElement('p'); note.className = 'hint'; note.textContent = t('Read manually: numeric/source checks do not verify every prose claim.'); li.append(note); }
      const sources = document.createElement('p'); sources.className = 'hint'; sources.textContent = (result.source_ids || []).join(', '); li.append(sources); list.append(li);
    }
    const m = ledger?.metrics;
    $('followup-accounting').textContent = m ? `${t('Separate follow-up session')}: ${formatRunMetrics(m).requests} · ${formatRunMetrics(m).tokens} · ${t('calls')} ${m.model_calls}/3` : '';
  }
  async function load(runId) {
    try {
      const data = await api(`/api/runs/${runId}/followups`);
      if (id !== runId) return;
      ledger = data.followups; busy = ledger.results.some((r) => r.status === 'running'); render();
      if (busy) timer = setTimeout(() => load(runId), 600);
    } catch (err) { if (id === runId) { $('followup-error').hidden = false; $('followup-error').textContent = err.message; } }
  }
  $('followup-form').addEventListener('submit', async (event) => {
    event.preventDefault(); if (!id || busy || !ledger || ledger.results.length >= 3) return;
    const runId = id; busy = true; render(); $('followup-error').hidden = true;
    try { await api(`/api/runs/${runId}/followups`, { method: 'POST', body: JSON.stringify({ request: $('followup-request').value }) }); }
    catch (err) { if (id === runId) { $('followup-error').hidden = false; $('followup-error').textContent = `${err.code || ''}: ${errorExplanation(err.code)} ${err.message}`; } }
    finally { if (id === runId) { busy = false; await load(runId); } }
  });
  return {
    setRun(run) {
      const next = run?.final && ['completed', 'failed', 'stopped'].includes(run.status) ? run.run_id : null;
      if (next === id) return;
      clearTimeout(timer); id = next; ledger = null; busy = false;
      $('followup-request').value = ''; $('followup-error').hidden = true; $('followup-panel').open = false; render();
      if (id) load(id);
    },
    refresh: render,
  };
}
