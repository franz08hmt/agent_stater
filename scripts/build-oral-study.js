import { readFile, writeFile, lstat } from 'node:fs/promises';
import { resolve, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseStudy, renderMarkdown, escapeHtml, normalizeSearch } from './study/render.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), docs = resolve(root, 'docs');
const markdown = await readFile(resolve(docs, 'ORAL_EXAM_KNOWLEDGE.md'), 'utf8');
const parsed = parseStudy(markdown), resources = {};
// Only explicit references from the authored document, bounded and source-only.
for (const match of markdown.matchAll(/\[[^\]]+\]\(([^\s)]+)\)/g)) {
  const ref = match[1], path = resolve(docs, ref), name = relative(root, path).replaceAll('\\', '/');
  if (/^https?:/i.test(ref) || name.startsWith('..') || !/^(?:src|config|tests|scripts|data|public|docs)\//.test(name) && !/^[A-Z_]+\.md$/.test(name)) continue;
  if (!['.js', '.json', '.md', '.csv'].includes(extname(path)) || name.includes('/var/') || name.includes('.env')) continue;
  const info = await lstat(path).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || info.size > 512 * 1024) continue;
  resources[ref] = await readFile(path, 'utf8');
}
resources['font-license'] = await readFile(resolve(root, 'public/assets/fonts/OFL.txt'), 'utf8') + '\n\nHeroicons:\n' + await readFile(resolve(root, 'public/assets/icons/LICENSE'), 'utf8');
const essential = new Set([1, 3, 11, 14, 15, 17, 20, 21, 22, 23, 25, 28, 35, 36, 38, 39, 42, 49, 53, 54, 55, 56, 57, 58, 59, 60, 67, 69, 70, 72, 75]);
const questions = parsed.questions.map(q => ({ ...q, essential: essential.has(Number(q.id.slice(1))), search: normalizeSearch(`${q.title} ${q.body}`) }));
const icon = name => `<svg aria-hidden="true"><use href="#icon-${name}"/></svg>`;
const content = parsed.chapters.map((chapter, index) => `<section class="chapter" id="${chapter.id}"><h2>${escapeHtml(chapter.title)}</h2>${chapter.intro.trim() ? `<details class="chapter-notes"><summary>Bản đồ / hướng dẫn của chương</summary><section class="background-content">${renderMarkdown(chapter.intro)}</section></details>` : ''}${questions.filter(q => q.chapter === index).map(q => `<details class="question" id="${q.id}" data-known="false"><summary><span class="q-number">${q.label}</span><h3>${escapeHtml(q.title)}</h3>${icon('chevron-right')}</summary><section class="answer">${renderMarkdown(q.body)}</section><button type="button" class="mark" data-mark="${q.id}" aria-pressed="false">Đánh dấu đã nắm</button></details>`).join('')}</section>`).join('\n');
let symbols = '';
for (const name of ['bolt', 'shield-check', 'document-text', 'sparkles', 'chevron-right']) {
  const svg = await readFile(resolve(root, `public/assets/icons/${name}.svg`), 'utf8');
  symbols += `<symbol id="icon-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">${svg.replace(/^[\s\S]*?<svg[^>]*>|<\/svg>[\s\S]*$/g, '')}</symbol>`;
}
symbols += '<symbol id="icon-search" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-4.35-4.35m1.1-5.4a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z"/></symbol>';
let style = await readFile(new URL('./study/style.css', import.meta.url), 'utf8');
for (const [weight, file] of [[400, 'Regular'], [600, 'SemiBold']]) {
  const font = (await readFile(resolve(root, `public/assets/fonts/Poppins-${file}.ttf`))).toString('base64');
  style = `@font-face{font-family:Poppins;font-style:normal;font-weight:${weight};font-display:swap;src:url(data:font/ttf;base64,${font}) format('truetype')}\n` + style;
}
const hash = createHash('sha256').update(markdown).digest('hex');
const replacements = {
  '/*STUDY_CSS*/': style,
  '/*STUDY_JS*/': await readFile(new URL('./study/app.js', import.meta.url), 'utf8'),
  '/*STUDY_DATA*/': JSON.stringify({ chapters: parsed.chapters, questions, resources, hash }).replaceAll('<', '\\u003c'),
  '<!--STUDY_ICONS-->': `<svg class="icon-defs" aria-hidden="true"><defs>${symbols}</defs></svg>`,
  '<!--STUDY_HASH-->': hash,
  '<!--STUDY_CONTENT-->': content,
  '<!--STUDY_BACKGROUND-->': `<section class="background-content">${renderMarkdown(parsed.intro)}</section>`,
  '<!--STUDY_NAV-->': '<a href="#read-view" data-chapter="all" aria-current="page">Tất cả chương</a>' + parsed.chapters.map((c, i) => `<a href="#${c.id}" data-chapter="${i}">${escapeHtml(c.title)}</a>`).join(''),
  '<!--STUDY_OPTIONS-->': parsed.chapters.map((c, i) => `<option value="${i}">${escapeHtml(c.title)}</option>`).join(''),
};
let html = await readFile(new URL('./study/page.html', import.meta.url), 'utf8');
for (const [marker, value] of Object.entries(replacements)) html = html.replace(marker, () => value);
// Generated deliverable, not the source of truth; regenerate after Markdown changes.
await writeFile(resolve(docs, 'ORAL_EXAM_STUDY.html'), html);
console.log(`Built offline study: ${questions.length} questions, ${parsed.chapters.length} chapters, ${Object.keys(resources).length} source snapshots, ${Buffer.byteLength(html)} bytes.\nMarkdown SHA256: ${hash}`);
