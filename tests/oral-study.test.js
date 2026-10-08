import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseStudy, renderMarkdown, normalizeSearch } from '../scripts/study/render.js';
import { createStudyServer } from '../scripts/study/server.js';

test('study parses chapter/question boundaries, keeps all answers and rejects duplicate IDs', () => {
  const parsed = parseStudy('# Title\nIntro\n## 1. Chapter\nMap\n### Q01. Why?\nAnswer\n### Q02. How?\nMore\n## 2. Last\nNotes');
  assert.equal(parsed.questions.length, 2);
  assert.equal(parsed.questions[0].chapter, 0);
  assert.equal(parsed.questions[1].body.trim(), 'More');
  assert.equal(parsed.chapters[1].intro.trim(), 'Notes');
  assert.throws(() => parseStudy('## A\n### Q01. X\nA\n### Q01. Y\nB'), /duplicate/i);
});

test('chapter-like headings inside code fences remain answer text, not new chapters', () => {
  const parsed = parseStudy('## Chapter\n### Q01. Code?\n```md\n## Example\n### Q02. Not a question\n```\nExplanation');
  assert.equal(parsed.chapters.length, 1);
  assert.equal(parsed.questions.length, 1);
  assert.match(parsed.questions[0].body, /## Example/);
});

test('offline renderer escapes untrusted text/code and denies unsafe link schemes', () => {
  const html = renderMarkdown('**Bold** `x<y`\n\n<script>alert(1)</script>\n\n[bad](javascript:alert)\n\n```js\n</script><img onerror=alert(1)>\n```');
  assert.match(html, /<strong>Bold<\/strong>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|onerror=alert\(1\)>|href="javascript:/);
});

test('renderer gives tables scroll regions, preserves lists and embeds local reference IDs', () => {
  const html = renderMarkdown('| A | B |\n|---|---|\n| 1 | 2 |\n\n1. One\n2. Two\n\n[code](../src/agent/runner.js)\n\n[docs](https://docs.ollama.com/faq)');
  assert.match(html, /<th scope="col">A/);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /<ol><li>One<\/li><li>Two/);
  assert.match(html, /data-resource="\.\.\/src\/agent\/runner.js"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.equal(normalizeSearch('Trích xuất ĐỎ'), normalizeSearch('trich xuat do'));
});

test('documentation has sixty unique questions and keeps current limitations explicit', async () => {
  const md = await readFile(new URL('../docs/ORAL_EXAM_KNOWLEDGE.md', import.meta.url), 'utf8');
  const parsed = parseStudy(md);
  assert.equal(parsed.questions.length, 60);
  assert.match(parsed.questions.find(q => q.id === 'q14').body, /không có embedding model/);
  assert.match(parsed.questions.find(q => q.id === 'q49').body, /42 PASS, 8 FAIL, 1 BLOCKED/);
  assert.match(parsed.questions.find(q => q.id === 'q56').body, /không cập nhật trọng số/);
});

test('study server serves only study HTML and refuses agent/API/secrets/mutations', async () => {
  const server = createStudyServer('<!doctype html><title>Study</title>');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(url);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Study/);
    assert.match(res.headers.get('content-security-policy'), /connect-src 'none'/);
    for (const path of ['/.env', '/api/runs', '/src/server.js', '/var/runs/a.json', '/%2e%2e/.env']) {
      assert.equal((await fetch(url + path)).status, 404);
    }
    assert.equal((await fetch(url, { method: 'POST', body: 'not a run' })).status, 405);
    assert.equal((await fetch(url, { method: 'HEAD' })).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
