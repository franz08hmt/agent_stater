// Selection for NEW runs. Historical configuration is rendered separately in Dialogue.
import { t as translate, currentLocale, TOOL_HINTS } from './i18n.js';
const $ = (id) => document.getElementById(id);
const setText = (id, value) => { if ($(id).textContent !== value) $(id).textContent = value; };
const node = (tag, text) => { const n = document.createElement(tag); if (text != null) n.textContent = text; return n; };

export async function setupConfiguration(api, onChange) {
  const catalog = await api('/api/catalog');
  let locked = false, probing = false, renderedTaskId = null;
  const probes = new Map();
  const probeFailures = new Map();
  for (const [element, entries, defaultId] of [
    [$('task-select'), catalog.tasks, catalog.default_task_id],
    [$('model-select'), catalog.model_profiles, catalog.default_model_profile_id],
  ]) {
    element.replaceChildren();
    for (const item of entries) {
      const option = node('option', `${item.title ?? item.label}${item.status === 'unavailable' ? ` — ${translate('unavailable')}` : ''}`);
      option.value = item.id; element.append(option);
    }
    element.value = defaultId;
  }
  const selected = () => ({ task_id: $('task-select').value, model_profile_id: $('model-select').value });
  const task = () => catalog.tasks.find((x) => x.id === selected().task_id);
  const profile = () => catalog.model_profiles.find((x) => x.id === selected().model_profile_id);
  function probeText(p) {
    if (!p) return translate('Connection: not checked. A probe sends at most one request.');
    const usage = p.metrics.tokens.reported.total == null ? translate('usage unavailable') : `${p.metrics.tokens.reported.total} ${translate('provider tokens')}`;
    const outcome = p.is_mock ? translate('Mock simulation; no real LLM connection checked')
      : p.error ? p.error.message : translate('Endpoint responded; probe JSON protocol valid');
    return `${outcome}. ${p.metrics.provider_requests} ${translate('HTTP request(s)')}; ${usage}. ${translate('Checked')} ${new Date(p.checked_at).toLocaleTimeString()}. ${translate('This does not guarantee task answers.')}`;
  }
  function refresh() {
    const t = task(), p = profile();
    for (const option of $('model-select').options) {
      const item = catalog.model_profiles.find((profile) => profile.id === option.value);
      option.textContent = `${item.label}${item.status === 'unavailable' ? ` — ${translate('unavailable')}` : ''}`;
    }
    $('task-select').disabled = locked || probing; $('model-select').disabled = locked || probing;
    setText('configuration-status', `${translate(locked ? 'Selections locked for this active run. ' : 'Applies to the next run. ')}${translate('Backend configured; model ')}${p.status === 'configured' ? translate('configuration valid') : `${translate('unavailable')}: ${p.reason}`}.`);
    setText('selected-model-state', `${translate(p.is_mock ? 'Mock' : 'Live')} · ${p.name} · ${translate(p.status)}`);
    setText('model-badge', `${translate(p.is_mock ? 'Mock' : 'Live')} · ${p.name}${p.status === 'unavailable' ? ` · ${translate('unavailable')}` : ''}`);
    $('model-badge').className = `badge ${p.is_mock ? 'is-mock' : 'is-live'}`;
    $('profile-title').textContent = t.title;
    $('knowledge').textContent = `${t.data.note_count ?? t.data.notes.length} ${translate('note sources')}; ${t.data.datasets.length} ${translate('datasets')}`;
    $('retrieval-kind').textContent = t.data.retrieval;
    const writes = t.tools.filter((x) => x.access === 'write');
    $('write-policy').textContent = writes.length ? `${writes.length} ${translate('write tool(s), approval required')}` : translate('Read-only');
    if (renderedTaskId !== `${t.id}:${currentLocale()}`) {
      const tools = $('task-tools'); tools.replaceChildren();
      for (const tool of t.tools) {
        const item = node('li'); item.append(node('strong', `${tool.name} · ${tool.access}${tool.requires_approval ? ` · ${translate('approval required')}` : ''}`));
        if (currentLocale() === 'vi' && TOOL_HINTS[tool.name]) item.append(node('p', translate(TOOL_HINTS[tool.name])));
        item.append(node('p', tool.description)); tools.append(item); // full backend contract remains verbatim
      }
      const data = $('task-data'); data.replaceChildren();
      if (t.data.notes.length) {
        data.append(node('p', `${translate('Allowed note sources')} (BM25; ${translate('showing')} ${t.data.notes.length} ${translate('of')} ${t.data.note_count ?? t.data.notes.length}):`));
        const notes = node('ul'); for (const n of t.data.notes) notes.append(node('li', `${n.source_id} — ${n.title} (${n.passage_count} ${translate('passages')})`)); data.append(notes);
      }
      for (const d of t.data.datasets) {
        data.append(node('p', `${d.id}: ${d.row_count} ${translate('records')} · snapshot ${d.version.slice(0, 12)}`));
        data.append(node('p', d.columns.map((c) => `${c.name}: ${c.type}${c.scale != null ? ` (${c.scale} ${translate('decimals')})` : ''}`).join(' · ')));
      }
      if (!t.data.notes.length && !t.data.datasets.length) data.append(node('p', translate('No data sources enabled.')));
      const samples = document.querySelector('.samples'); samples.replaceChildren(node('legend', translate('Example goals')));
      for (const sample of t.sample_inputs) {
        const button = node('button', sample.label); button.type = 'button'; button.dataset.goal = sample.goal;
        const icon = node('span'); icon.className = 'icon icon--chevron-right'; icon.setAttribute('aria-hidden', 'true'); button.append(icon); samples.append(button);
      }
      renderedTaskId = `${t.id}:${currentLocale()}`;
    }
    for (const button of document.querySelectorAll('.samples button')) button.disabled = locked;
    document.querySelector('.policy-note').hidden = !writes.length;
    setText('probe-result', probing ? translate('Checking model…') : probeFailures.get(p.id) ?? probeText(probes.get(p.id)));
    const probe = probes.get(p.id);
    setText('probe-summary', probing ? translate('Checking model…') : probeFailures.get(p.id) ?? (p.status !== 'configured' ? translate('Model unavailable') : !probe ? translate('Connection not checked') : `${probe.is_mock ? translate('Mock simulation') : probe.error ? probe.error.message : translate('Probe protocol valid')} · ${new Date(probe.checked_at).toLocaleTimeString()}`));
    $('probe-model').disabled = locked || probing || p.status !== 'configured';
    onChange({ ready: p.status === 'configured' && !locked && !probing, task: t, profile: p });
  }
  for (const id of ['task-select', 'model-select']) $(id).addEventListener('change', refresh);
  $('probe-model').addEventListener('click', async () => {
    const id = profile().id; probing = true; probeFailures.delete(id); refresh();
    $('model-check').setAttribute('aria-busy', 'true');
    try { const { probe } = await api(`/api/model-profiles/${encodeURIComponent(id)}/probe`, { method: 'POST', body: '{}' }); probes.set(id, probe); }
    catch (err) { probeFailures.set(id, `${translate("Probe unavailable")}: ${err.message}`); }
    finally { probing = false; $('model-check').setAttribute('aria-busy', 'false'); refresh(); }
  });
  refresh();
  return { selected, refresh, catalog,
    setRun(run) {
      locked = ['running', 'awaiting_approval'].includes(run?.status);
      if (locked) {
        if (catalog.tasks.some((t) => t.id === run.task_id)) $('task-select').value = run.task_id;
        if (catalog.model_profiles.some((p) => p.id === run.model_profile_id)) $('model-select').value = run.model_profile_id;
      }
      refresh();
    },
  };
}
