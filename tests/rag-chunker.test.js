import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chunkMarkdown, kbChecksum, normalizeKb, documentIdFromFileName, CHUNKER_VERSION } from '../src/rag/chunker.js';
import { ROOT } from './helpers.js';

const KB_FILE = 'KB-B_Sunrise-Family-Clinic-Patient-Guide.md';
const kbText = () => readFileSync(join(ROOT, 'data', 'sunrise', KB_FILE), 'utf8');

test('Sunrise KB: one chunk per "## N." section, whole sections, stable IDs', () => {
  const { document, chunks } = chunkMarkdown(kbText(), { fileName: KB_FILE });
  assert.equal(document.id, 'kb-b');
  assert.match(document.title, /^Sunrise Family Clinic — Patient Guide/);
  assert.equal(chunks.length, 11);
  assert.deepEqual(chunks.map((c) => c.source_id), Array.from({ length: 11 }, (_, i) => `kb-b-s${String(i + 1).padStart(2, '0')}-c1`));
  assert.deepEqual(chunks.map((c) => c.section_number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  for (const c of chunks) {
    assert.ok(c.text.length <= 1200, `${c.source_id} is ${c.text.length} chars`);
    assert.equal(c.chunk_count, 1);
    assert.equal(c.overlap_chars, 0, 'sections that are not split get no overlap');
    assert.ok(c.source_id.length <= 60);
    assert.match(c.text_sha256, /^[0-9a-f]{64}$/);
  }
});

test('Sunrise KB: the update section and the fee table keep their conditions and exceptions intact', () => {
  const { chunks } = chunkMarkdown(kbText(), { fileName: KB_FILE });
  const s10 = chunks.find((c) => c.section_number === 10).text;
  assert.match(s10, /dermatology consultation fee is increased to 500,000 VND\. Other consultation fees do not change\./);
  assert.match(s10, /Bao Viet direct billing is suspended at the Thu Duc branch/);
  assert.match(s10, /Direct billing for Bao Viet continues at the District 1 branch\./);
  const s4 = chunks.find((c) => c.section_number === 4).text;
  assert.match(s4, /\| Dermatology consultation\s+\| 450,000 VND \|/, 'the OLD price stays in section 4; section 10 overrides it, nothing is rewritten');
  assert.match(s4, /Telehealth follow-ups are charged the full telehealth fee\./);
  assert.match(s4, /Children under 6 years old get 20% off general consultations\./);
  const s8 = chunks.find((c) => c.section_number === 8).text;
  assert.match(s8, /Members get:\n\n- 5% off/, 'a lead-in line is never separated from its list');
});

test('chunking is deterministic and independent of line endings', () => {
  const a = chunkMarkdown(kbText(), { fileName: KB_FILE });
  const b = chunkMarkdown(kbText().replace(/\n/g, '\r\n'), { fileName: KB_FILE });
  assert.deepEqual(a.chunks, b.chunks);
  assert.equal(kbChecksum(kbText()), kbChecksum(kbText().replace(/\n/g, '\r\n')));
  assert.notEqual(kbChecksum(kbText()), kbChecksum(kbText().replace('500,000', '501,000')));
  assert.equal(normalizeKb('a\r\nb\rc'), 'a\nb\nc');
  assert.equal(CHUNKER_VERSION, 'markdown-section-v1');
});

const longSection = (n) => Array.from({ length: n }, (_, i) => `Sentence number ${i + 1} explains rule ${i + 1} and an exception for rule ${i + 1}.`).join(' ');

test('a long section is split; chunks stay within max_chars; only split sections overlap', () => {
  const md = `# Doc\n\n## 1. Short\n\nShort section.\n\n## 2. Long\n\n${longSection(60)}\n\n## 3. After\n\nAnother short section.\n`;
  const { chunks } = chunkMarkdown(md, { fileName: 'x.md', maxChars: 400, overlapChars: 60 });
  const long = chunks.filter((c) => c.section_number === 2);
  assert.ok(long.length > 3, `expected several chunks, got ${long.length}`);
  for (const c of chunks) assert.ok(c.text.length <= 400, `${c.source_id} is ${c.text.length}`);
  assert.deepEqual(long.map((c) => c.chunk_number), long.map((_, i) => i + 1));
  assert.ok(long.every((c) => c.chunk_count === long.length));
  assert.equal(long[0].overlap_chars, 0);
  assert.ok(long.slice(1).every((c) => c.overlap_chars > 0 && c.overlap_chars <= 60), 'continuation chunks carry about overlap_chars of context');
  for (const i of [1, 2]) assert.ok(long[i].text.startsWith(long[i].text.slice(0, long[i].overlap_chars)) && long[i - 1].text.includes(long[i].text.slice(0, long[i].overlap_chars)), 'the overlap really is the tail of the previous chunk');
  assert.equal(chunks.find((c) => c.section_number === 1).overlap_chars, 0);
  assert.equal(chunks.find((c) => c.section_number === 3).overlap_chars, 0, 'independent sections never overlap');
  // no sentence is cut in the middle: every chunk body ends at a sentence end
  for (const c of long) assert.match(c.text.trim(), /\.$/);
});

test('a split table repeats its header row in every part', () => {
  const rows = Array.from({ length: 30 }, (_, i) => `| Service ${i + 1} | ${100 + i},000 VND |`).join('\n');
  const md = `# Doc\n\n## 1. Fees\n\n| Service | Fee |\n| --- | --- |\n${rows}\n`;
  const { chunks } = chunkMarkdown(md, { fileName: 'fees.md', maxChars: 300, overlapChars: 40 });
  assert.ok(chunks.length > 2);
  for (const c of chunks) {
    assert.ok(c.text.startsWith('| Service | Fee |\n| --- | --- |'), `${c.source_id} lost the header`);
    assert.ok(c.text.length <= 300);
    assert.equal(c.overlap_chars, 0, 'table parts repeat the header instead of overlapping partial rows');
  }
  const all = chunks.map((c) => c.text).join('\n');
  for (let i = 1; i <= 30; i++) assert.match(all, new RegExp(`\\| Service ${i} \\|`), `row ${i} was lost`);
});

test('a split list keeps its lead-in line in every part', () => {
  const items = Array.from({ length: 25 }, (_, i) => `- Benefit ${i + 1}: ${'detail '.repeat(6).trim()}`).join('\n');
  const md = `# Doc\n\n## 1. Perks\n\nMembers get:\n\n${items}\n`;
  const { chunks } = chunkMarkdown(md, { fileName: 'p.md', maxChars: 320, overlapChars: 40 });
  assert.ok(chunks.length > 2);
  assert.ok(chunks.every((c) => c.text.includes('Members get:')));
});

test('configuration and structure are validated', () => {
  assert.throws(() => chunkMarkdown('# t\n\nno sections here', { fileName: 'x.md' }), /no "## " sections/);
  assert.throws(() => chunkMarkdown('# t\n\n## 1. A\n\nx\n\n## 1. B\n\ny', { fileName: 'x.md' }), /Duplicate section number 1/);
  assert.throws(() => chunkMarkdown('# t\n\n## 1. A\n\nx', { fileName: 'x.md', maxChars: 10 }), /max_chars/);
  assert.throws(() => chunkMarkdown('# t\n\n## 1. A\n\nx', { fileName: 'x.md', maxChars: 1000, overlapChars: 900 }), /overlap_chars/);
  assert.equal(documentIdFromFileName('KB-B_Sunrise-Family-Clinic-Patient-Guide.md'), 'kb-b');
  assert.equal(documentIdFromFileName('Weird Name!!.md'), 'weird-name');
  assert.equal(documentIdFromFileName('___.md'), 'kb');
});
