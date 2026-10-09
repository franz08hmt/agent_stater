// Real Chromium QA for the Sunrise RAG task: the retrieved-chunks view, print sheet, embedding accounting,
// VI/EN, Exam mode, reload and keyboard use. Local only: the "embedding model" is a fake HTTP server and the LLM is
// scripted, so nothing here can reach a cloud service or a real model (and proves UI wiring, not retrieval quality).
//   npm run qa:rag
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { browserQa, until } from './browserQa.js';
import { sunriseFixture, call, final, SUNRISE } from '../tests/rag-helpers.js';

const cleanups = [];
const shim = { after: (fn) => cleanups.push(fn) };
const FEE_ANSWER = 'The current dermatology consultation fee is 520,000 VND, effective 1 October 2026.';
const GOAL = 'What is the current dermatology consultation fee?';

const qa = await browserQa();
const results = [];
try {
  const { read, click, send } = qa;
  const type = async (selector, text) => { await click(selector); await send('Input.insertText', { text }); };
  const KEYS = { Enter: { vk: 13, text: '\r' }, Tab: { vk: 9 } };
  const key = async (name) => { const { vk, text: chars } = KEYS[name]; const base = { key: name, code: name, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
    await send('Input.dispatchKeyEvent', { type: chars ? 'keyDown' : 'rawKeyDown', ...base, ...(chars ? { text: chars } : {}) }); await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }); };
  const text = (selector) => read(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
  const visible = (selector) => read(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); return Boolean(e && !e.hidden && e.getClientRects().length); })()`);
  const noOverflow = async (label) => {
    for (const [width, height, mobile] of [[1366, 768, false], [390, 844, true]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
      assert.equal(await read('document.documentElement.scrollWidth <= window.innerWidth'), true, `${label}: horizontal overflow at ${width}px`);
      await qa.screenshot(`${label}`, width, { height });
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  };
  const open = async (app, hash = '#configuration') => {
    await send('Page.navigate', { url: `${app}/${hash}` });
    await until(() => read("document.querySelector('#model-badge')?.textContent.includes('scripted-mock')"), 'UI ready');
    await read("(()=>{const e=document.getElementById('ui-locale');e.value='en';e.dispatchEvent(new Event('change',{bubbles:true}));})()");
  };
  const status = (expected) => until(() => read(`document.querySelector('#status')?.textContent === ${JSON.stringify(expected)}`), `status ${expected}`);
  const requests = (f) => ({ embed: f.fake.embedHits().length, llm: f.model.calls.length });
  const pass = (name, detail) => { results.push(name); console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`); };

  // ── 1. index not built: the task is visible but cannot be started, and says exactly what to do ──
  {
    const f = await sunriseFixture(shim, { indexed: false });
    const app = await f.serve();
    await open(app);
    assert.match(await text('#vector-index'), /missing: .*npm run rag:index -- --task=sunrise-clinic-rag/);
    assert.match(await text('#configuration-status'), /vector index is not ready/i);
    assert.equal(await read("document.querySelector('#start').disabled"), true);
    const refused = await read(`fetch('/api/runs', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({goal:${JSON.stringify(GOAL)}})}).then(async r => [r.status, (await r.json()).error])`);
    assert.deepEqual(refused, [409, 'index_not_ready']);
    assert.deepEqual(requests(f), { embed: 0, llm: 0 });
    await noOverflow('rag-index-missing');
    pass('index missing', 'start disabled, 409 index_not_ready, 0 embedding / 0 LLM requests');
  }

  // ── 2. a completed answer: sources with section titles, retrieved chunks, print, VI/EN, Exam, reload ──
  {
    const f = await sunriseFixture(shim, { replies: [call('dermatology consultation fee'), final(FEE_ANSWER, ['kb-b-s10-c1'])] });
    const app = await f.serve();
    await open(app);
    const vector = await text('#vector-index');
    assert.match(vector, /^ready · [0-9a-f]{12} · 48 dimensions · 1200\/100 chars · top-k 3 \+ sections 1, 10$/);
    assert.match(await text('#retrieval-kind'), /vector \(cosine\) · embeddinggemma/);
    assert.match(await text('#knowledge'), /^11 KB chunks · Sunrise Family Clinic/);
    assert.equal(await visible('#retrieval-details'), false, 'no retrieval view before a run');
    assert.equal(await visible('#metrics-embeddings-row'), false);
    await type('#goal', GOAL);
    await click('#start');
    await status('Completed');
    const baseline = requests(f);
    assert.deepEqual(baseline, { embed: 2, llm: 2 }, 'one index batch + one query embedding; two scripted LLM calls');

    assert.equal(await text('#answer'), FEE_ANSWER);
    const source = await text('#sources li');
    assert.match(source, /^10\. Updates \(effective 1 October 2026\) — kb-b-s10-c1$/);
    assert.match(await text('#metrics-embeddings'), /^1 \/ 3 embedding HTTP request\(s\) · .* s · input tokens \d+$/);
    assert.match(await text('#metrics-requests'), /Mock, no HTTP$/, 'LLM accounting stays separate from embedding accounting');
    assert.doesNotMatch(await text('#metrics-requests'), /embedding/);

    // the details block: closed by default, opened with the keyboard, keeps its state while polling
    assert.equal(await visible('#retrieval-details'), true);
    assert.equal(await read("document.querySelector('#retrieval-details').open"), false);
    await read("document.querySelector('#retrieval-details > summary').focus()");
    await key('Enter');
    assert.equal(await read("document.querySelector('#retrieval-details').open"), true, 'Enter opens the details');
    await key('Tab');
    assert.equal(await read('document.activeElement?.id'), 'print-retrieval', 'Tab reaches the print button next');
    assert.notEqual(await read('getComputedStyle(document.activeElement).outlineStyle'), 'none', 'keyboard focus is visible');

    const api = await read(`fetch('/api/runs/' + document.querySelector('#run-id').textContent + '/retrieval').then(r => r.json()).then(j => j.retrieval)`);
    assert.equal(api.calls.length, 1);
    const ids = api.calls[0].items.map((i) => i.source_id);
    assert.ok(ids.includes('kb-b-s01-c1') && ids.includes('kb-b-s10-c1'), 'required sections 1 and 10 are present');
    assert.equal(new Set(ids).size, ids.length, 'deduplicated');
    const dom = await read("[...document.querySelectorAll('#retrieval-calls .retrieval-item')].map(li => ({ head: li.querySelector('strong').textContent, meta: li.querySelector('span').textContent, text: li.querySelector('pre').textContent }))");
    assert.equal(dom.length, ids.length, 'the view shows exactly the chunks the API reports (= what the model saw)');
    api.calls[0].items.forEach((item, i) => {
      assert.equal(dom[i].head, `${item.section} — ${item.source_id}`);
      assert.equal(dom[i].text, item.text, 'chunk text is shown in full');
      assert.ok(dom[i].meta.includes(`rank #${item.rank}`) && dom[i].meta.includes(item.score.toFixed(4)));
    });
    assert.equal(dom.filter((d) => d.meta.includes('cited in the answer')).length, 1);
    assert.ok(dom.find((d) => d.head.endsWith('kb-b-s10-c1')).meta.includes('cited in the answer'));
    assert.ok(dom.find((d) => d.head.endsWith('kb-b-s10-c1')).meta.includes('required context') || dom.find((d) => d.head.endsWith('kb-b-s10-c1')).meta.toLowerCase().includes('required'));
    await delay(1500); // several poll ticks (none while completed) must not close or rebuild it
    assert.equal(await read("document.querySelector('#retrieval-details').open"), true);
    await noOverflow('rag-completed-open');

    // print: the button prepares ONLY the print sheet; nothing else is printed
    await read("window.__print = []; window.print = () => window.__print.push({ cls: document.body.className, sheet: document.querySelector('#print-sheet').textContent });");
    await click('#print-retrieval');
    const printed = await read('window.__print');
    assert.equal(printed.length, 1);
    assert.equal(printed[0].cls, 'printing-retrieval');
    for (const needle of [api.run_id, 'Retrieved chunks', GOAL, 'embeddinggemma', 'kb-b-s10-c1', api.calls[0].items[0].text.slice(0, 40), 'embedding HTTP request(s)']) assert.ok(printed[0].sheet.includes(needle), `print sheet lacks "${needle}"`);
    assert.equal(await read('document.body.className'), '', 'the print class is removed afterwards');
    await read("document.body.classList.add('printing-retrieval')");
    await send('Emulation.setEmulatedMedia', { media: 'print' });
    const laidOut = await read(`(() => { const sheet = document.querySelector('#print-sheet'); const shown = (e) => getComputedStyle(e).display !== 'none';
      return { sheet: shown(sheet), main: shown(document.querySelector('main')), header: shown(document.querySelector('header')), overflowing: [...sheet.querySelectorAll('pre')].filter(p => p.scrollWidth > p.clientWidth + 1).length, clipped: getComputedStyle(sheet).overflow, height: sheet.getBoundingClientRect().height, scroll: sheet.scrollHeight }; })()`);
    assert.deepEqual([laidOut.sheet, laidOut.main, laidOut.header, laidOut.overflowing, laidOut.clipped], [true, false, false, 0, 'visible']);
    assert.ok(laidOut.height >= laidOut.scroll - 1, 'print sheet is not clipped');
    const pdf = await send('Page.printToPDF', { printBackground: false });
    assert.ok(Buffer.from(pdf.data, 'base64').subarray(0, 4).toString() === '%PDF');
    await send('Emulation.setEmulatedMedia', { media: '' });
    await read("document.body.classList.remove('printing-retrieval')");
    assert.equal(await read("getComputedStyle(document.querySelector('#print-sheet')).display"), 'none', 'the sheet is invisible on screen');
    assert.deepEqual(requests(f), baseline, 'printing makes no model or embedding request');

    // locale and mode toggles: static re-render only, details stay open, no requests
    await read("(()=>{const e=document.getElementById('ui-locale');e.value='vi';e.dispatchEvent(new Event('change',{bubbles:true}));})()");
    assert.equal(await text('#retrieval-details > summary'), 'Đoạn đã truy xuất');
    assert.match(await text('#metrics-embeddings'), /HTTP request embedding/);
    assert.match(await read("document.querySelector('#retrieval-calls').textContent"), /Ngữ cảnh bắt buộc/);
    assert.equal(await read("document.querySelector('#retrieval-details').open"), true);
    await click('#exam-mode');
    assert.equal(await read('document.documentElement.dataset.mode'), 'exam');
    assert.equal(await visible('#retrieval-details'), true);
    assert.equal(await read("document.querySelector('#retrieval-details').open"), true);
    await noOverflow('rag-exam-vi');
    await click('#exam-mode');
    await read("(()=>{const e=document.getElementById('ui-locale');e.value='en';e.dispatchEvent(new Event('change',{bubbles:true}));})()");
    assert.equal(await text('#retrieval-details > summary'), 'Retrieved chunks');
    assert.deepEqual(requests(f), baseline, 'locale/mode toggles cause no model or embedding request');

    // reload of a completed run: same run, same chunks, still no requests
    await send('Page.reload');
    await until(() => visible('#retrieval-details'), 'restored retrieval view');
    assert.equal(await text('#answer'), FEE_ANSWER);
    await click('#retrieval-details > summary');
    await until(() => read("document.querySelectorAll('#retrieval-calls .retrieval-item').length === " + ids.length), 'restored chunks');
    assert.deepEqual(requests(f), baseline, 'reload causes no model or embedding request');
    pass('completed answer', `${ids.length} chunks shown, print sheet, VI/EN, Exam, reload; requests stayed ${JSON.stringify(baseline)}`);
  }

  // ── 3. the KB does not contain the answer: honest "I don't know" ──
  {
    const f = await sunriseFixture(shim, { replies: [call('dental braces orthodontics'), final('The Sunrise guide does not mention dental braces.', [], 'No section of the guide covers dental services.')] });
    const app = await f.serve();
    await open(app);
    await type('#goal', 'Does the clinic offer dental braces?');
    await click('#start');
    await status('Completed');
    assert.match(await text('#sources li'), /No source cited/);
    assert.match(await text('#unresolved'), /No section of the guide covers dental services/);
    assert.equal(await visible('#retrieval-details'), true, 'the chunks that were searched are still inspectable');
    await click('#retrieval-details > summary');
    assert.ok((await read("document.querySelectorAll('#retrieval-calls .retrieval-item').length")) >= 2);
    assert.equal(await read("document.querySelectorAll('#retrieval-calls .retrieval-item').length > 0 && ![...document.querySelectorAll('#retrieval-calls .retrieval-item span')].some(s => s.textContent.includes('cited in the answer'))"), true);
    await noOverflow('rag-unknown');
    pass('unknown answer', 'no source cited, unresolved shown, retrieved chunks inspectable');
  }

  // ── 4. embedding endpoint fails during the run: the failure is visible and counted, no chunk is invented ──
  {
    const f = await sunriseFixture(shim, { ollama: { fail: (n) => (n >= 2 ? { status: 503 } : null) },
      replies: [call('dermatology fee'), final('The knowledge base could not be searched, so I cannot answer.', [], 'Embedding service failed.')] });
    const app = await f.serve();
    await open(app);
    await type('#goal', GOAL);
    await click('#start');
    await status('Completed');
    assert.match(await text('#metrics-embeddings'), /^1 \/ 3 embedding HTTP request\(s\) · 1 failed · .* input tokens unavailable$/);
    assert.equal(await text('#sources li'), 'No source cited — read the unresolved explanation.');
    assert.match(await read("[...document.querySelectorAll('#trace tr')].map(r => r.textContent).join('\\n')"), /search_kb[\s\S]*error/);
    assert.equal(await visible('#retrieval-details'), true);
    await click('#retrieval-details > summary');
    assert.match(await text('#retrieval-calls'), /No chunk was retrieved in this run\./);
    assert.equal(f.fake.embedHits().length, 2, 'index build + exactly one failed query request, no retry');
    await noOverflow('rag-embedding-failure');
    pass('embedding failure', '1 failed request counted, unavailable tokens not shown as 0, no retry');
  }

  // ── 5. reload while the run is still going, details opened mid-run keep their state ──
  {
    const f = await sunriseFixture(shim, { replies: [call('dermatology fee'), { delayMs: 2500, text: final(FEE_ANSWER, ['kb-b-s10-c1']) }] });
    const app = await f.serve();
    await open(app);
    await type('#goal', GOAL);
    await click('#start');
    await until(() => visible('#retrieval-details'), 'retrieval visible while running');
    assert.equal(await text('#status'), 'Running');
    await click('#retrieval-details > summary');
    assert.equal(await read("document.querySelector('#retrieval-details').open"), true);
    assert.equal(await read("[...document.querySelectorAll('#retrieval-calls .retrieval-item span')].some(s => s.textContent.includes('cited in the answer'))"), false);
    const during = requests(f);
    await send('Page.reload');
    await until(() => read("document.querySelector('#status')?.textContent === 'Running'"), 'running run restored');
    assert.deepEqual(requests(f), during, 'reload while running starts nothing');
    await click('#retrieval-details > summary');
    await status('Completed');
    assert.equal(await read("document.querySelector('#retrieval-details').open"), true, 'polling did not close it');
    await until(() => read("[...document.querySelectorAll('#retrieval-calls .retrieval-item span')].some(s => s.textContent.includes('cited in the answer'))"), 'citation flag after completion');
    assert.deepEqual(requests(f), { embed: 2, llm: 2 });
    pass('reload while running', 'run restored, details kept open across polling and completion, no extra requests');
  }

  // The only tolerated entry is the deliberate 409 of scenario 1 (starting a run while the index is missing).
  assert.deepEqual(qa.errors, ['Failed to load resource: the server responded with a status of 409 (Conflict)'], 'no other browser runtime/console errors');
  console.log(`\n${results.length} scenarios passed in real Chromium. Screenshots: ${qa.artifacts}`);
} finally {
  await qa.close();
  for (const fn of cleanups.reverse()) await fn();
}
