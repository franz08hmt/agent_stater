// Real isolated Chrome, study document only: no provider, agent API or cloud.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createStudyServer } from './study/server.js';
import { browserQa, until } from './browserQa.js';
import { parseStudy } from './study/render.js';

const html = await readFile(new URL('../docs/ORAL_EXAM_STUDY.html', import.meta.url), 'utf8');
const questionCount = parseStudy(await readFile(new URL('../docs/ORAL_EXAM_KNOWLEDGE.md', import.meta.url), 'utf8')).questions.length;
const server = createStudyServer(html);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`, browser = await browserQa();
const { read, click, send } = browser, results = [];
const visible = 'document.querySelectorAll(".question:not([hidden])").length';
const key = async (name, code = name) => {
  const vk = { Enter: 13, Escape: 27, Backspace: 8, Home: 36, End: 35, ArrowDown: 40 }[name] || 0;
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: vk, ...(name === 'Enter' ? { text: '\r' } : {}) });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: vk });
};
async function search(value) {
  await click('#search'); await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 });
  await key('Backspace'); if (value) await send('Input.insertText', { text: value });
  assert.equal(await read('document.getElementById("search").value'), value, 'native search input');
}
async function navigate(destination) {
  await send('Page.navigate', { url: destination });
  await until(() => read(`document.readyState === "complete" && document.querySelectorAll('.question').length===${questionCount} && document.getElementById('result-count')?.textContent.includes('${questionCount}')`), 'study ready');
  await read('document.fonts.ready');
}
try {
  await navigate(url);
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Page.bringToFront');
  assert.equal(await read(visible), questionCount);
  assert.equal(await read('document.querySelectorAll("h1").length'), 1);
  assert.equal(await read('(()=>{const ids=[...document.querySelectorAll("[id]")].map(e=>e.id);return new Set(ids).size===ids.length})()'), true);
  for (const width of [320, 390, 768, 1366, 1920]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: width < 800 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 600 });
    assert.equal(await read('document.documentElement.scrollWidth <= innerWidth'), true, `overflow ${width}`);
    await browser.screenshot('study-home', width, { height: width < 800 ? 844 : 900, fullPage: false });
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await search('trong so');
  assert.ok(await read(visible) > 0, 'accent-free content search');
  await search('zz-no-match-zz'); assert.equal(await read('document.getElementById("empty").hidden'), false);
  await search(''); await click('#essential'); assert.equal(await read(visible), 31);
  await search('model free'); await click('#quiz-mode');
  assert.equal(await read('document.getElementById("quiz-answer").hidden'), true);
  assert.match(await read('document.getElementById("quiz-question").textContent'), /free/);
  await click('#reveal'); assert.equal(await read('document.getElementById("quiz-answer").hidden'), false);
  await click('#quiz-known'); assert.match(await read('document.getElementById("progress-label").textContent'), new RegExp(`1 / ${questionCount}`));
  await send('Page.reload');
  await until(() => read(`document.getElementById("progress-label")?.textContent.startsWith("1 / ${questionCount}")`), 'progress reload');
  await click('#essential'); await click('#unlearned'); assert.equal(await read(visible), 30);
  await click('#unlearned'); await click('#essential'); await search('Code nào là LLM');
  await click('#q23 summary');
  await browser.screenshot('study-inference', 390, { height: 844, fullPage: false });
  assert.equal(await read('document.documentElement.scrollWidth <= innerWidth'), true);
  await click('#q23 [data-resource="../src/model/openaiCompatible.js"]');
  assert.match(await read('document.getElementById("source-code").textContent'), /fetch\(url/);
  assert.equal(await read('document.getElementById("source-dialog").open'), true);
  await browser.screenshot('study-source', 390, { height: 844, fullPage: false });
  await key('Escape'); assert.equal(await read('document.getElementById("source-dialog").open'), false);
  await click('#reset'); await click('#cancel-reset'); assert.match(await read('document.getElementById("progress-label").textContent'), new RegExp(`1 / ${questionCount}`));
  await click('#reset'); await click('#confirm-reset'); assert.match(await read('document.getElementById("progress-label").textContent'), new RegExp(`0 / ${questionCount}`));
  await search(''); await click('#quiz-mode');
  const before = await read('document.getElementById("quiz-question").textContent');
  await click('#next'); assert.notEqual(await read('document.getElementById("quiz-question").textContent'), before);
  await click('#previous'); assert.equal(await read('document.getElementById("quiz-question").textContent'), before);
  await click('#random'); assert.notEqual(await read('document.getElementById("quiz-question").textContent'), before);
  await click('#read-mode');
  // Native keyboard activation of the accordion, not a JS-only open state.
  await search('Code nào là LLM'); await click('#q23 summary');
  const wasOpen = await read('document.getElementById("q23").open');
  assert.equal(await read('document.activeElement.tagName'), 'SUMMARY', 'accordion receives native focus');
  await key('Enter');
  assert.equal(await read('document.getElementById("q23").open'), !wasOpen, 'Enter toggles native accordion');
  await search('');
  await click('#chapter-select'); await key('Home'); for (let i = 0; i < 4; i++) await key('ArrowDown'); await key('Enter');
  assert.ok(await read(visible) < questionCount, 'chapter filter');
  results.push('mobile filters/search, quiz/reveal/navigation, progress/reload/reset, source viewer/Escape, native keyboard, responsive 320–1920');
  const external = browser.responses.filter(r => /^https?:/.test(r.url) && !r.url.startsWith(url));
  assert.equal(external.length, 0, 'no external dependency or agent API');
  assert.equal(browser.errors.length, 0);
  // file:// has no server dependency and storage may be unavailable.
  await navigate(new URL('../docs/ORAL_EXAM_STUDY.html', import.meta.url).href);
  await click('#quiz-mode'); await click('#reveal');
  assert.equal(await read('document.getElementById("quiz-answer").hidden'), false);
  results.push('standalone file:// reading and quiz');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'Object.defineProperty(window,"localStorage",{get(){throw new Error("Storage blocked test");}});' });
  await navigate(url); await click('#q1 summary'); await click('#q1 .mark');
  assert.match(await read('document.getElementById("storage-note").textContent'), /không cho lưu/);
  assert.match(await read('document.getElementById("progress-label").textContent'), new RegExp(`1 / ${questionCount}`));
  results.push('blocked localStorage fallback');
  assert.equal(browser.errors.length, 0);
  const report = { status: 'PASS', results, provider_requests: 0, external_requests: 0, artifacts: browser.artifacts };
  await writeFile(join(browser.artifacts, 'oral-study-qa.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
