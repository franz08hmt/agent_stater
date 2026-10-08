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
    assert.match(await text('task-tools'),/Tra cứu ghi chú.*BM25/);
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
    // Separate follow-up context and accounting. Original final/metrics must stay byte-for-byte identical.
    const parentId=await text('run-id'), beforeRun=app.runner.getRun(parentId);
    app.controls.followupReply=JSON.stringify({answer:final,source_ids:beforeRun.final.source_ids});
    let followupRelease; app.controls.requestGate=new Promise(r=>followupRelease=r);
    await click('#followup-panel summary');
    await read("document.getElementById('followup-request').value='Giải thích lại bằng tiếng Việt.'");
    await click('#followup-send');
    await until(()=>app.requests.length===count+1,'follow-up HTTP started');
    await choose('ui-locale','vi'); assert.equal(app.requests.length,count+1);
    const inFlightMarker=await read('window.i18nMarker=crypto.randomUUID()'); await send('Page.reload');
    await until(()=>read(`window.i18nMarker!==${JSON.stringify(inFlightMarker)}&&document.getElementById('followup-results').textContent.includes('running')`),'follow-up running reload');
    assert.equal(app.requests.length,count+1); followupRelease(); app.controls.requestGate=null;
    await until(()=>read("document.getElementById('followup-results').textContent.includes('REVIEW_REQUIRED')"),'follow-up stored');
    assert.equal(app.requests.length,count+1); assert.deepEqual(app.runner.getRun(parentId),beforeRun);
    assert.match(await text('followup-accounting'),/1 \/ 3/);
    await choose('ui-locale','vi'); assert.equal(await text('answer'),final); assert.equal(app.requests.length,count+1);
    const followupMarker=await read('window.i18nMarker=crypto.randomUUID()'); await send('Page.reload');
    await until(()=>read(`window.i18nMarker!==${JSON.stringify(followupMarker)}&&document.getElementById('followup-results').textContent.includes('REVIEW_REQUIRED')`),'follow-up restored');
    assert.equal(app.requests.length,count+1); assert.deepEqual(app.runner.getRun(parentId),beforeRun);
    await read("window.location.hash='#configuration'"); await click('#new-run');
    assert.equal(await read("document.getElementById('followup-panel').hidden"),true);
    assert.equal(await text('followup-results'),'');
    // All four natural goal-language combinations. Fake HTTP establishes plumbing only.
    for(const [ui,goal,answer] of [
      ['en','HTTP 429 có nghĩa gì?','HTTP 429 là giới hạn tần suất.'],
      ['vi','Explain HTTP 429.','HTTP 429 indicates rate limiting.'],
      ['vi','Giải thích HTTP 429 bằng tiếng Anh.','HTTP 429 indicates rate limiting.'],
      ['en','Explain HTTP 429 in Vietnamese.','HTTP 429 là giới hạn tần suất.'],
    ]) {
      await choose('ui-locale',ui); await choose('model-select','http');
      app.controls.runReply=messages=>JSON.stringify(messages.some(m=>m.content.startsWith('OBSERVATION'))?{type:'final',answer,source_ids:['http-status'],unresolved:''}:{type:'tool_call',tool:'search_notes',arguments:{query:'HTTP 429',limit:1}});
      await read(`document.getElementById('goal').value=${JSON.stringify(goal)}`); await click('#start');
      await until(async()=>{const id=await text('run-id');return app.runner.getRun(id).goal===goal&&app.runner.getRun(id).status==='completed'&&await text('answer')===answer;},'language example');
      assert.equal(app.runner.getRun(await text('run-id')).goal,goal);
      await read("window.location.hash='#configuration'"); await click('#new-run');
    }
    assert.deepEqual(await read('Object.keys(localStorage).sort()'),['agent-studio.ui-locale','agent-studio.ui-mode']); // New run removes only the viewed-run marker.
    let probeRelease; app.controls.probeGate=new Promise(r=>probeRelease=r);
    await choose('ui-locale','en'); const beforeProbe=app.requests.length; await click('#probe-model');
    await until(()=>app.requests.length===beforeProbe+1,'explicit probe started');
    assert.equal(await text('probe-summary'),'Checking model…');
    await choose('ui-locale','vi'); assert.equal(await text('probe-summary'),'Đang kiểm tra model…');
    assert.equal(app.requests.length,beforeProbe+1); probeRelease(); app.controls.probeGate=null;
    await until(()=>read("!document.getElementById('probe-model').disabled"),'probe finished');
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
