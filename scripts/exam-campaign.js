// Explicit, sequential LOCAL campaign. No cloud, download, auto-failover or hidden retries.
import { mkdtemp, cp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvironment } from '../src/operations/context.js';
import { saveReport } from '../src/operations/reports.js';
import { inspectLocalModel, localEndpoint } from '../src/operations/localModel.js';
import { campaignCheck, campaignGroup, createCampaignSession, summarizeMetrics, passStreaks } from '../src/operations/campaign.js';
import { runSuite } from '../src/operations/suite.js';
import { runProposalSuite, PROPOSAL_CASES, ROOM_REJECT_CASE } from '../src/operations/proposalSuite.js';
import { runInjectionSuite } from '../src/operations/injectionSuite.js';
import { SMOKE_CASES, REHEARSAL_CASES } from '../src/operations/cases.js';
import { scaffoldProject } from '../src/scaffold/apply.js';
import { runAcceptanceTask } from '../src/scaffold/acceptance.js';
import { loadCatalog } from '../config/catalog.config.js';

let env, session, groups=[],checks=[],inspect,temporary;
try {
  const options={profile:'ollama-qwen3',repeat:3,cap:160};
  for(const arg of process.argv.slice(2)) {
    const match=/^--(profile|repeat|cap)=(.+)$/.exec(arg);if(!match)throw new Error('Use --profile=ollama-qwen3 --repeat=3 --cap=160.');
    options[match[1]]=match[1]==='profile'?match[2]:Number(match[2]);
  }
  if(!Number.isInteger(options.repeat)||options.repeat<1||options.repeat>3)throw new Error('Repeat must be 1..3.');
  env=await loadEnvironment();if(env.evidenceContext.working_tree_modified)throw new Error('Commit the reviewed candidate before live verification.');
  const profile=env.catalog.profiles.get(options.profile);if(!profile)throw new Error('Unknown profile.');localEndpoint(profile);
  session=createCampaignSession(options.cap);inspect=await inspectLocalModel(profile);
  console.log(JSON.stringify({candidate:env.evidenceContext.commit,configuration_id:env.service.configuration_id,profile:options.profile,inspect,cap:session.limit}));
  if(inspect.status!=='PASS')throw new Error('Installed local model inspection blocked; no model request sent.');
  for(const kind of ['warm','probe']){const check=await campaignCheck(session,profile,kind);checks.push(check);console.log(JSON.stringify({kind,status:check.status,requests:session.used}));}
  const group=async(name,runner,cases,groupEnv=env,scope='actual_catalog')=>{
    const report=await campaignGroup(session,runner,{env:groupEnv,cases,repeat:options.repeat,live:true,profileId:options.profile});
    const saved=await saveReport(env,'campaign-group',{...report,scope,group:name,scope_configuration_id:groupEnv.service?.configuration_id??null});groups.push(saved);
    console.log(JSON.stringify({group:name,report_id:saved.report_id,requests:session.used,results:report.results.map(r=>({id:r.id,trial:r.trial,status:r.status,reason:r.reason}))}));
  };
  await group('notes-dataset-draft',runSuite,SMOKE_CASES);
  await group('counts-and-empty',runSuite,REHEARSAL_CASES.filter(c=>['tickets-compare','tickets-empty','rooms-empty'].includes(c.id)));
  await group('proposals',runProposalSuite,[...PROPOSAL_CASES,ROOM_REJECT_CASE]);
  temporary=await mkdtemp(join(tmpdir(),'exam-live-scaffold-'));
  for(const folder of ['config','data'])await cp(join(env.root,folder),join(temporary,folder),{recursive:true});
  const spec=JSON.parse(await readFile(join(env.root,'templates/rehearsal-rentals.spec.json'),'utf8'));
  await scaffoldProject({root:temporary,spec,register:true});await scaffoldProject({root:temporary,spec,register:true,apply:true});
  const acceptance=await runAcceptanceTask({root:temporary,id:spec.task.id});if(acceptance.status!=='PASS')throw new Error('Scaffold offline acceptance failed.');
  const catalog=await loadCatalog({root:temporary,config:env.config});
  const scopeEnv={...env,root:temporary,catalog};
  await group('scaffold-custom-id',runSuite,[{id:'rentals-sum',taskId:spec.task.id,kind:'table',tool:'query_dataset',goal:'Sum hours for rentals department Robotics. Answer Robotics = <total>.',args:spec.cases[0].args,expected:'11',answer:'Robotics = 11.'}],scopeEnv,'temporary_scaffold_catalog');
  await group('injection-E16',runInjectionSuite,[{id:'E16'}]);
  const results=groups.flatMap(g=>g.results), streaks=passStreaks(results);
  const metrics=summarizeMetrics([...checks,...results]);
  if(metrics.provider_requests!==session.used)throw new Error('Campaign accounting mismatch.');
  const status=['FAIL','BLOCKED','REVIEW_REQUIRED','NOT_RUN'].find(s=>[...checks,...results].some(r=>r.status===s))??'PASS';
  const final=await saveReport(env,'live-campaign',{status,inspect,checks,session,metrics,group_reports:groups.map(g=>g.report_id),results,consecutive_passes:streaks,
    demo_ready_cases:Object.keys(streaks).filter(id=>streaks[id]>=3),semantic_review:'Read all finals/arguments/sources; narrow grader PASS does not prove all unseen tasks.'});
  console.log(JSON.stringify({report_id:final.report_id,status,session,metrics,consecutive_passes:streaks},null,2));
} catch(error){
  console.error(error.message);
  if(env) {const report=await saveReport(env,'live-campaign',{status:'BLOCKED',reason:error.message,inspect,checks,session,group_reports:groups.map(g=>g.report_id),results:groups.flatMap(g=>g.results)});console.error(`Preserved report: ${report.report_id}`);}
  process.exitCode=2;
} finally {if(temporary){if(!temporary.startsWith(join(tmpdir(),'exam-live-scaffold-')))throw new Error('Unsafe cleanup');await rm(temporary,{recursive:true,force:true});}}
