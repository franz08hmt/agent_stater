// Retrieved-chunks debug view. The model (data → rows) is pure and tested in Node; the DOM part only
// writes with textContent, so KB text, queries and section titles are never interpreted as HTML.
// Nothing here calls a model or an embedding endpoint: it reads GET /api/runs/:id/retrieval.
import { t } from './i18n.js';

const MATCH_LABEL = { semantic: 'Semantic match', required: 'Required context', 'semantic+required': 'Semantic match + required context' };

export const matchLabel = (match) => t(MATCH_LABEL[match] ?? match);

/** One line of embedding accounting. Missing usage stays "unavailable"; it is never shown as 0. */
export function embeddingSummary(e) {
  if (!e) return null;
  const tokens = e.tokens?.reported_input == null ? t('input tokens unavailable') : `${t('input tokens')} ${e.tokens.reported_input.toLocaleString('en-US')}`;
  const failed = e.failed ? ` · ${e.failed} ${t('failed')}` : '';
  return `${e.requests} / ${e.limits.requests} ${t('embedding HTTP request(s)')}${failed} · ${(e.ms / 1000).toFixed(1)} s · ${tokens}`;
}

/** Plain rows for rendering and printing. `cited` marks chunks whose source_id the final answer cites. */
export function retrievalModel(view) {
  const cited = new Set(view?.cited_source_ids ?? []);
  const calls = (view?.calls ?? []).map((call, index) => ({
    number: index + 1,
    query: call.query,
    indexId: call.index_id,
    omitted: call.omitted_semantic_matches ?? 0,
    items: call.items.map((item) => ({
      sourceId: item.source_id, section: item.section, chunk: item.chunk, match: item.match,
      rank: Number.isInteger(item.rank) ? item.rank : null,
      score: Number.isFinite(item.score) ? item.score : null,
      text: item.text, chars: item.text.length, cited: cited.has(item.source_id),
    })),
  }));
  return { calls, cited: [...cited], embeddings: embeddingSummary(view?.embeddings), empty: calls.length === 0 };
}

const node = (document, tag, text, className) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (className) n.className = className;
  return n;
};

const scoreText = (score) => (score == null ? t('unavailable') : score.toFixed(4));

/** Renders the call list into `container` (replacing only its children). */
export function renderCalls(document, container, model) {
  container.replaceChildren();
  if (model.empty) { container.append(node(document, 'p', t('No chunk was retrieved in this run.'), 'hint')); return; }
  for (const call of model.calls) {
    const section = node(document, 'section', undefined, 'retrieval-call');
    section.setAttribute('aria-label', `${t('Search')} ${call.number}`);
    section.append(node(document, 'h5', `${t('Search')} ${call.number}: ${call.query}`));
    const meta = `${t('Index')} ${String(call.indexId).slice(0, 12)} · ${call.items.length} ${t('chunk(s) given to the model')}${call.omitted ? ` · ${call.omitted} ${t('weaker match(es) dropped by the size budget')}` : ''}`;
    section.append(node(document, 'p', meta, 'hint'));
    const list = node(document, 'ol', undefined, 'retrieval-items');
    for (const item of call.items) {
      const li = node(document, 'li', undefined, `retrieval-item match-${item.match.replace('+', '-')}`);
      li.append(node(document, 'strong', `${item.section} — ${item.sourceId}`));
      li.append(node(document, 'span', `${matchLabel(item.match)} · ${t('rank')} #${item.rank ?? '—'} · ${t('cosine')} ${scoreText(item.score)} · ${t('chunk')} ${item.chunk} · ${item.chars} ${t('chars')}${item.cited ? ` · ${t('cited in the answer')}` : ''}`, 'hint'));
      li.append(node(document, 'pre', item.text));
      list.append(li);
    }
    section.append(list);
    container.append(section);
  }
}

/** Print sheet: shown only under @media print, so it is never clipped by the workspace layout. */
export function renderPrintSheet(document, sheet, view, info) {
  const model = retrievalModel(view);
  sheet.replaceChildren();
  sheet.append(node(document, 'h1', t('Retrieved chunks')));
  const facts = node(document, 'dl', undefined, 'print-facts');
  for (const [label, value] of [
    [t('Run ID'), view.run_id], [t('Task'), info.task], [t('Model'), info.model], [t('Goal'), info.goal],
    [t('Embedding model'), info.embedding ?? t('unavailable')], [t('Embedding requests'), model.embeddings ?? t('unavailable')],
    [t('Cited sources'), model.cited.length ? model.cited.join(', ') : t('none')],
  ]) { const row = node(document, 'div'); row.append(node(document, 'dt', label), node(document, 'dd', String(value))); facts.append(row); }
  sheet.append(facts);
  const body = node(document, 'div', undefined, 'print-calls');
  renderCalls(document, body, model);
  sheet.append(body);
}
