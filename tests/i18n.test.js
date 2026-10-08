import test from 'node:test';
import assert from 'node:assert/strict';
import { t, setLocale, readLocale, rememberLocale, setupLocale } from '../public/i18n.js';
test('UI locale is an enum with storage fallback and independently rendered labels', () => {
  assert.equal(readLocale({ getItem: () => 'broken' }), 'en');
  assert.equal(readLocale({ getItem() { throw Error(); } }), 'en');
  let written; const storage = { setItem: (k,v) => written = [k,v] };
  rememberLocale(storage, 'vi'); assert.deepEqual(written, ['agent-studio.ui-locale', 'vi']);
  rememberLocale(storage, 'bad'); assert.deepEqual(written, ['agent-studio.ui-locale', 'vi']);
  setLocale('vi'); assert.equal(t('Run agent'), 'Chạy agent'); assert.equal(t('Awaiting approval'), 'Chờ phê duyệt');
  assert.equal(t('Source {id}', { id: 'ds-products-123' }), 'Nguồn ds-products-123');
  setLocale('en'); assert.equal(t('Run agent'), 'Run agent');
});
test('locale changes only static labels/attributes; leaves data/focus/state alone and does not call APIs', () => {
  let listener, changes = 0;
  const button = { value: 'en', addEventListener: (_,fn) => listener=fn };
  const label = { dataset: { i18n: 'Run agent' }, textContent: 'Run agent' };
  const input = { value: 'Tạo đề xuất CAM1', dataset: { i18nPlaceholder: 'Describe a task for this agent.' }, setAttribute: (k,v) => input[k]=v };
  const doc = { documentElement: { lang: 'en' }, getElementById: () => button,
    querySelectorAll: (selector) => selector === '[data-i18n]' ? [label] : selector === '[data-i18n-placeholder]' ? [input] : [] };
  setupLocale(doc, { getItem: () => 'en', setItem() {} }, () => changes++);
  button.value='vi'; listener(); assert.equal(label.textContent, 'Chạy agent'); assert.equal(doc.documentElement.lang, 'vi');
  assert.equal(input.value, 'Tạo đề xuất CAM1'); assert.equal(changes, 2); setLocale('en');
});
