// Runs from the RESTORED project, not the original source. No install or Internet.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvironment } from '../src/operations/context.js';
import { createApp } from '../src/app.js';
import { createScriptedModel } from '../src/model/mock.js';
import { PROPOSAL_CASES, scriptedProposalDecision } from '../src/operations/proposalSuite.js';

const env=await loadEnvironment({dotenv:false}), directory=await mkdtemp(join(tmpdir(),'restored-smoke-store-'));
let app;
try {
  assert.equal(env.config.model.provider,'mock','Restore check explicitly uses mock.');
  const c=PROPOSAL_CASES[0],task=env.catalog.tasks.get(c.taskId).task;
  let proposal=false;
  const base=env.catalog.profiles.get('mock').model;
  const scripted=createScriptedModel([messages=>scriptedProposalDecision(c,messages,task.datasets)]);
  env.catalog.profiles.get('mock').model={...base,complete:args=>(proposal?scripted:base).complete(args)};
  app=await createApp({config:env.config,catalog:env.catalog,publicDir:join(env.root,'public'),varDir:directory,service:env.service});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${app.server.address().port}`;
  const get=async path=>{const res=await fetch(url+path);assert.equal(res.status,200,path);return res;};
  const post=async(path,body)=>{const res=await fetch(url+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(res.status,200,`${path}: ${await res.clone().text()}`);return res.json();};
  assert.equal((await (await get('/api/health')).json()).ok,true);
  assert.equal((await (await get('/api/catalog')).json()).tasks.length,6);
  const assets=['/','/app.js','/configuration.js','/exam-mode.js','/styles.css'];
  for(const asset of assets)assert.ok((await (await get(asset)).arrayBuffer()).byteLength);
  const start=async body=>{const response=await fetch(url+'/api/runs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,202);return (await response.json()).run;};
  // The rule mock has a documented keyword-coverage heuristic, not English semantics.
  const first=await start({goal:'HTTP 401 403',model_profile_id:'mock'});await app.runner.idle(first.run_id);
  const read=app.runner.getRun(first.run_id);assert.equal(read.status,'completed');assert.ok(read.final.source_ids.includes('http-status'));
  assert.equal(read.metrics.provider_requests,0);
  proposal=true;const begun=await start({goal:c.goal,task_id:c.taskId,model_profile_id:'mock'});await app.runner.idle(begun.run_id);
  const pending=app.runner.getRun(begun.run_id);assert.equal(pending.status,'awaiting_approval');const a=pending.approvals.at(-1);
  const route=`/api/runs/${begun.run_id}/approvals/${a.approval_id}`,body={decision:'approve',args_hash:a.args_hash};
  await post(route,body);await app.runner.idle(begun.run_id);assert.equal((await post(route,body)).replayed,true);
  const final=app.runner.getRun(begun.run_id),proposals=await app.store.listProposals();
  assert.equal(final.status,'completed');assert.equal(proposals.length,1);assert.equal(proposals[0].applied,false);assert.ok(await task.verifyCurrent());
  assert.equal(final.metrics.provider_requests,0);
  console.log(JSON.stringify({status:'PASS',node_requirement:'>=22.12.0',node:process.versions.node,health_catalog:'PASS',local_static_assets:assets,
    read_workflow:'PASS',proposal_workflow:'PASS',atomic_publication_replay:'PASS',proposal_count:1,source_data_unchanged:true,provider_requests:0,install_performed:false,internet_required:false}));
} finally {if(app){app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}if(!directory.startsWith(join(tmpdir(),'restored-smoke-store-')))throw new Error('Unsafe cleanup');await rm(directory,{recursive:true,force:true});}
