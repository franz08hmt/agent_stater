// Real Chromium, isolated fake HTTP + stores; no local/cloud LLM calls.
import assert from 'node:assert/strict';
import { browserQa, until } from './browserQa.js';
import { createConfigurationDemo } from './configurationDemoFixture.js';
import { createProposalDemo } from './proposalDemoFixture.js';
const browser = await browserQa(), {read,send,click}=browser;
const choose=(id,value)=>read(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
const text=id=>read(`document.getElementById(${JSON.stringify(id)}).textContent`);
const ready=()=>until(()=>read("!!document.getElementById('task-select')&&!document.getElementById('task-select').disabled"),'UI ready');
const measurements=[]; let requests=0;
async function measure(width,height,selectors) {
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
  await read("window.scrollTo({top:0,behavior:'instant'})");
  assert.equal(await read('document.documentElement.scrollWidth<=innerWidth'),true,`overflow ${width}`);
  const rects=await read(`(${JSON.stringify(selectors)}).map(s=>{const r=document.querySelector(s).getBoundingClientRect();return {s,top:r.top,bottom:r.bottom,within:r.top>=0&&r.bottom<=innerHeight}})`);
  if(width>=1000) for(const r of rects) assert.ok(r.within,JSON.stringify(r));
  measurements.push({width,height,rects}); await browser.screenshot('i18n-vi',width,{height,fullPage:false});
}
try {
  const app=await createConfigurationDemo();
  try {
    await send('Page.navigate',{url:app.url+'/#configuration'}); await ready();
    await choose('ui-locale','vi'); assert.equal(await read('document.documentElement.lang'),'vi');
    await click('#exam-mode'); assert.match(await text('start'),/Chạy agent/);
    for(const [w,h] of [[1366,768],[1920,1080],[390,844],[320,740]]) await measure(w,h,['#goal','#start']);
    await choose('model-select','http');
    let release; app.controls.requestGate=new Promise(r=>release=r);
    await read("document.getElementById('goal').value='Explain HTTP 401 and 403.'");
    await click('#start'); await until(()=>app.requests.length===1,'request received');
    await click('#run-details summary');
    const originalGoal=await read("document.getElementById('goal').value");
    await choose('ui-locale','en'); await choose('ui-locale','vi');
    assert.equal(app.requests.length,1); assert.equal(await read("document.getElementById('goal').value"),originalGoal);
    assert.equal(await read("document.getElementById('run-details').open"),true);
    const marker=await read('window.i18nMarker=crypto.randomUUID()'); await send('Page.reload');
    await until(()=>read(`!!document.getElementById('run-panel')&&!document.getElementById('run-panel').hidden&&window.i18nMarker!==${JSON.stringify(marker)}`),'restored running');
    assert.equal(await read('document.documentElement.lang'),'vi'); assert.equal(app.requests.length,1);
    release(); await until(async()=>await text('status')==='Hoàn tất','completed');
    const final=await text('answer'), count=app.requests.length;
    await choose('ui-locale','en'); assert.equal(await text('answer'),final); assert.equal(app.requests.length,count);
    assert.deepEqual(await read('Object.keys(localStorage).sort()'),['agent-studio.ui-locale','agent-studio.ui-mode','agent-studio.viewed-run']);
    // Wrong/blocked storage has a safe English fallback.
    await read("localStorage.setItem('agent-studio.ui-locale','bad')"); await send('Page.reload'); await ready();
    assert.equal(await read('document.documentElement.lang'),'en'); requests+=app.requests.length;
  } finally { await app.close(); }
  const app2=await createProposalDemo();
  try {
    await send('Page.navigate',{url:app2.url+'/#configuration'}); await ready(); await choose('ui-locale','vi'); await click('#exam-mode');
    await read("document.getElementById('goal').value='Create a proposal to change ticket T2 status to closed.'"); await click('#start');
    await until(async()=>await text('status')==='Chờ phê duyệt','pending');
    const args=await text('approval-args'), hash=await text('approval-hash'), before=app2.requests.length;
    await choose('ui-locale','en'); await choose('ui-locale','vi');
    assert.equal(await text('approval-args'),args); assert.equal(await text('approval-hash'),hash); assert.equal(app2.requests.length,before);
    await measure(1366,768,['#approve','#reject']); await measure(390,844,[]); await measure(320,740,[]);
    await click('#reject'); await until(async()=>await text('status')==='Hoàn tất','reject final');
    assert.equal((await app2.store.listProposals()).length,0); assert.match(await text('write-outcome'),/Không lưu đề xuất/);
    requests+=app2.requests.length;
  } finally { await app2.close(); }
  assert.deepEqual(browser.errors,[]); assert.equal(browser.responses.filter(r=>r.status>=400).length,0);
  console.log(JSON.stringify({status:'PASS',fake_http_requests:requests,real_llm_requests:0,measurements,screenshots:browser.artifacts},null,2));
} finally { await browser.close(); }
