import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { loadEnvironment } from '../src/operations/context.js';
import { createOpenAICompatibleModel } from '../src/model/openaiCompatible.js';
import { campaignCheck, campaignGroup, createCampaignSession, summarizeMetrics, passStreaks } from '../src/operations/campaign.js';
import { runSuite } from '../src/operations/suite.js';
import { SMOKE_CASES } from '../src/operations/cases.js';
import { runProposalSuite, ROOM_REJECT_CASE } from '../src/operations/proposalSuite.js';
import { runInjectionSuite } from '../src/operations/injectionSuite.js';

async function provider(t) {
  let requests = 0;
  const server = createServer(async (req,res) => { for await (const _ of req) {} requests++; res.writeHead(503, {'content-type':'application/json'}); res.end('{"error":"fixture"}'); });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  const env=await loadEnvironment({dotenv:false}), old=env.catalog.profiles.get('ollama-qwen3');
  const config={...old.config,baseUrl:`http://127.0.0.1:${server.address().port}/v1/`,apiKey:''};
  const profile={...old,config,model:createOpenAICompatibleModel(config)};
  env.catalog.profiles.set(profile.id,profile);
  return {env,profile,requests:()=>requests};
}
test('global campaign includes warm/probe; exhausted cap stops checks before HTTP and preserves missing usage',async(t)=>{
  const p=await provider(t),session=createCampaignSession(1);
  const warm=await campaignCheck(session,p.profile,'warm'); assert.equal(warm.status,'BLOCKED');
  assert.equal(warm.metrics.provider_requests,1); assert.equal(warm.metrics.retries,0);
  const probe=await campaignCheck(session,p.profile,'probe'); assert.equal(probe.status,'NOT_RUN');
  assert.equal(p.requests(),1); assert.equal(session.used,1);
  const totals=summarizeMetrics([warm,probe]); assert.equal(totals.reported.total,null); assert.ok(totals.estimated.total>0); assert.equal(totals.unavailable_requests,1);
});
test('global remaining cap gates retry at the actual HTTP adapter, then marks all future trials NOT_RUN',async(t)=>{
  const p=await provider(t),session=createCampaignSession(1),cases=[SMOKE_CASES[0]];
  const r=await campaignGroup(session,runSuite,{env:p.env,cases,live:true,profileId:p.profile.id,repeat:3});
  assert.equal(p.requests(),1); assert.equal(session.used,1); assert.equal(r.results[0].metrics.provider_requests,1);
  assert.equal(r.results[0].metrics.retries,0); assert.deepEqual(r.results.map(r=>r.status),['BLOCKED','NOT_RUN','NOT_RUN']);
  const next=await campaignGroup(session,runSuite,{env:p.env,cases,live:true,profileId:p.profile.id,repeat:3});
  assert.ok(next.results.every(r=>r.status==='NOT_RUN')); assert.equal(p.requests(),1);
});
test('campaign rejects unbounded/invalid cap, keeps actual usage distinct and resets PASS streak on failure',()=>{
  for(const n of [0,161,Infinity,1.5])assert.throws(()=>createCampaignSession(n));
  assert.equal(createCampaignSession().limit,160);
  assert.deepEqual(passStreaks([{id:'a',status:'PASS'},{id:'a',status:'FAIL'},{id:'a',status:'PASS'},{id:'b',status:'REVIEW_REQUIRED'}]),{a:1,b:0});
  const t=summarizeMetrics([{metrics:{provider_requests:2,repairs:1,retries:1,model_ms:25,tokens:{reported:{input:10,output:5,total:15},estimated:{input:20,output:30,total:50},unavailable_requests:1,invalid_usage_requests:0,pending_requests:0}}}]);
  assert.equal(t.reported.total,15);assert.equal(t.estimated.total,50);assert.equal(t.usage_status,'mixed');
});
test('room reject uses real lookup evidence, approval/hash/replay and creates zero proposals',async()=>{
  const env=await loadEnvironment({dotenv:false});
  const r=await runProposalSuite({env,cases:[ROOM_REJECT_CASE],profileId:'mock'});
  assert.equal(r.status,'PASS');const trial=r.results[0];assert.equal(trial.replayed,true);assert.equal(trial.proposals.length,0);
  assert.equal(trial.approvals.at(-1).state,'rejected');assert.equal(trial.dataset_unchanged,true);assert.equal(trial.final.answer,'Proposal not saved.');
});

test('E16 uses the existing evaluator and shares the remaining campaign cap, including blocked retries',async(t)=>{
  const p=await provider(t),session=createCampaignSession(1);
  const report=await campaignGroup(session,runInjectionSuite,{env:p.env,cases:[{id:'E16'}],repeat:3,profileId:p.profile.id});
  assert.equal(p.requests(),1);assert.equal(session.used,1);
  assert.deepEqual(report.results.map(r=>r.status),['BLOCKED','NOT_RUN','NOT_RUN']);
  assert.equal(report.results[0].metrics.provider_requests,1);assert.equal(report.results[0].metrics.retries,0);
});
