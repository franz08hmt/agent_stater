import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { retrievalModel, embeddingSummary, renderCalls, renderPrintSheet, matchLabel } from '../public/retrieval-view.js';
import { setLocale, VI } from '../public/i18n.js';
import { ROOT } from './helpers.js';

// Minimal DOM: no innerHTML at all, so any code path that tried to parse markup would throw.
class FakeNode {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.className = ''; this._text = ''; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this._text = ''; this.children = nodes; }
  setAttribute(k, v) { this.attributes[k] = v; }
  find(tag) { return [...(this.tag === tag ? [this] : []), ...this.children.flatMap((c) => c.find(tag))]; }
}
const document = { createElement: (tag) => new FakeNode(tag) };

const item = (over = {}) => ({ source_id: 'kb-b-s04-c1', section: '4. Consultation Fees', chunk: '1/1', match: 'semantic', rank: 1, score: 0.8123, text: 'Dermatology: 450,000 VND', ...over });
const view = (over = {}) => ({
  run_id: 'r1', task_id: 'sunrise-clinic-rag', status: 'completed', cited_source_ids: ['kb-b-s10-c1'],
  calls: [{ query: 'dermatology fee', index_id: 'a'.repeat(64), omitted_semantic_matches: 1, items: [item(), item({ source_id: 'kb-b-s10-c1', section: '10. Updates', match: 'required', rank: 7, score: 0.2, text: 'New fee 520,000 VND' })] }],
  embeddings: { requests: 1, failed: 0, ms: 420, limits: { requests: 3 }, tokens: { reported_input: null } }, ...over,
});

test('the model keeps ranks, scores, match types and marks only the cited chunks', () => {
  const m = retrievalModel(view());
  assert.equal(m.calls[0].items.length, 2);
  assert.deepEqual(m.calls[0].items.map((i) => [i.sourceId, i.match, i.rank, i.cited]), [['kb-b-s04-c1', 'semantic', 1, false], ['kb-b-s10-c1', 'required', 7, true]]);
  assert.equal(m.calls[0].omitted, 1);
  assert.deepEqual(m.cited, ['kb-b-s10-c1']);
});

test('embedding accounting: missing usage is "unavailable", never 0; failures are shown', () => {
  setLocale('en');
  assert.equal(embeddingSummary(null), null);
  assert.match(embeddingSummary(view().embeddings), /^1 \/ 3 embedding HTTP request\(s\) · 0\.4 s · input tokens unavailable$/);
  assert.match(embeddingSummary({ requests: 3, failed: 2, ms: 10, limits: { requests: 3 }, tokens: { reported_input: 12 } }), /3 \/ 3 .* · 2 failed · .* input tokens 12$/);
  assert.doesNotMatch(embeddingSummary(view().embeddings), /tokens 0/);
});

test('a run with no retrieval renders an explicit empty state', () => {
  setLocale('en');
  const box = new FakeNode('div');
  renderCalls(document, box, retrievalModel({ calls: [], cited_source_ids: [], embeddings: null }));
  assert.match(box.textContent, /No chunk was retrieved in this run\./);
});

test('KB text, queries and titles are written as text, never parsed as markup', () => {
  setLocale('en');
  const hostile = '<img src=x onerror=alert(1)> **bold** &amp;';
  const v = view();
  v.calls[0].query = hostile; v.calls[0].items[0].text = hostile; v.calls[0].items[0].section = hostile;
  const box = new FakeNode('div');
  renderCalls(document, box, retrievalModel(v));
  assert.ok(box.find('pre').some((n) => n.textContent === hostile), 'chunk text is kept verbatim');
  assert.match(box.find('h5')[0].textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(box.find('img').length, 0);
});

test('the chunk list shows rank, cosine score, match type, section, chunk id and the citation flag', () => {
  setLocale('en');
  const box = new FakeNode('div');
  renderCalls(document, box, retrievalModel(view()));
  const text = box.textContent;
  for (const needle of ['4. Consultation Fees — kb-b-s04-c1', 'Semantic match', 'rank #1', 'cosine 0.8123', '10. Updates — kb-b-s10-c1', 'Required context', 'rank #7', 'cited in the answer', '1 weaker match(es) dropped by the size budget', 'Index aaaaaaaaaaaa']) assert.ok(text.includes(needle), needle);
  assert.equal(text.split('cited in the answer').length - 1, 1, 'only the cited chunk is flagged');
});

test('the print sheet carries run, task, model, embedding identity, accounting and every chunk', () => {
  setLocale('en');
  const sheet = new FakeNode('section');
  renderPrintSheet(document, sheet, view(), { task: 'Sunrise', model: 'Live gemma', goal: 'How much is dermatology?', embedding: 'embeddinggemma (embeddinggemma-v1)' });
  const text = sheet.textContent;
  for (const needle of ['Retrieved chunks', 'r1', 'Sunrise', 'Live gemma', 'How much is dermatology?', 'embeddinggemma (embeddinggemma-v1)', 'embedding HTTP request(s)', 'kb-b-s10-c1', 'Dermatology: 450,000 VND', 'New fee 520,000 VND']) assert.ok(text.includes(needle), needle);
  renderPrintSheet(document, sheet, view(), { task: 'x', model: 'y', goal: 'z', embedding: null });
  assert.ok(sheet.textContent.includes('unavailable'), 'unknown embedding identity is stated, not invented');
});

test('every UI string of the view has a Vietnamese translation and the labels switch with the locale', async () => {
  const source = await readFile(new URL('../public/retrieval-view.js', import.meta.url), 'utf8');
  const keys = [...source.matchAll(/\bt\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(keys.length > 20);
  for (const key of new Set(keys)) assert.ok(VI[key], `missing Vietnamese string for "${key}"`);
  for (const key of ['Semantic match', 'Required context', 'Semantic match + required context']) assert.ok(VI[key]);
  setLocale('vi'); assert.equal(matchLabel('required'), VI['Required context']);
  setLocale('en'); assert.equal(matchLabel('required'), 'Required context');
  assert.ok(!/innerHTML|insertAdjacentHTML/.test(source), 'the view must only use textContent');
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.ok(!/innerHTML|insertAdjacentHTML/.test(app));
});

test('the print stylesheet prints only the sheet, and only while the print button set its class', async () => {
  const css = await readFile(`${ROOT}/public/styles.css`, 'utf8');
  const print = css.slice(css.indexOf('@media print'));
  assert.match(print, /body\.printing-retrieval > :not\(#print-sheet\)\s*\{\s*display:\s*none !important/);
  assert.match(css, /#print-sheet\s*\{\s*display:\s*none;?\s*\}/);
  assert.match(print, /break-inside:\s*avoid/);
});
