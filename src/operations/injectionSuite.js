// E16 uses the existing evaluator, with the same HTTP gate as other campaign groups.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentRunner } from '../agent/runner.js';
import { createFileStore } from '../store/fileStore.js';
import { BudgetError } from '../agent/metrics.js';
import { buildSystemPrompt } from '../../config/prompts.js';
import { evaluateCase } from '../../eval/checks.js';
import { hash } from './context.js';
import { localEndpoint } from './localModel.js';

export async function runInjectionSuite({ env, cases, repeat, maxRequests, profileId }) {
  const profile = env.catalog.profiles.get(profileId); localEndpoint(profile);
  const definition = JSON.parse(await readFile(join(env.root, 'eval/cases.json'), 'utf8')).cases.find(c=>c.id==='E16');
  const entry = env.catalog.tasks.get('study-notes'), session={provider_requests:0,limit:maxRequests}, results=[];
  for(let trial=1;trial<=repeat;trial++) {
    if(session.provider_requests>=maxRequests){results.push({id:cases[0].id,trial,status:'NOT_RUN',reason:'Global campaign cap exhausted.'});continue;}
    const directory=await mkdtemp(join(tmpdir(),'exam-injection-'));
    try {
      const store=await createFileStore({root:directory}), decisions=[];
      const model={...profile.model, async complete(args){
        const control=args.requestControl;
        const reply=await profile.model.complete({...args,requestControl:{...control,
          beforeRequest(messages,cap){if(session.provider_requests>=maxRequests)throw new BudgetError('session_request_budget','Campaign cap exhausted.');return control.beforeRequest(messages,cap);},
          requestStarted(plan,retry){session.provider_requests++;return control.requestStarted(plan,retry);}
        }});
        try{decisions.push(JSON.parse(reply.text));}catch{decisions.push({invalid_protocol:true});}return reply;
      }};
      const runner=createAgentRunner({model,task:entry.task,registry:entry.registry,retriever:entry.retriever,store,limits:env.config.limits,modelTimeoutMs:env.config.model.timeoutMs});
      await runner.init();const started=await runner.startRun(definition.goal);await runner.idle(started.run_id);
      let run=runner.getRun(started.run_id);
      if(run.status==='awaiting_approval'){await runner.stopRun(run.run_id);run=runner.getRun(run.run_id);}
      const system=buildSystemPrompt({task:entry.task,tools:entry.registry.describe(),limits:env.config.limits,languagePolicy:run.language_policy});
      const verdict=evaluateCase(definition,run,{modelCalls:run.metrics.model_calls,drafts:(await store.listDrafts()).length,replayed:false,error:null},{registry:entry.registry,systemPrompt:system,apiKey:profile.config.apiKey});
      const status=run.failure?.code?.startsWith('model_')||run.failure?.code?.includes('budget')?'BLOCKED':verdict.status==='INCONCLUSIVE'?'REVIEW_REQUIRED':verdict.status;
      results.push({id:cases[0].id,trial,status,reason:[...verdict.fails,...verdict.info].join('; '),case_identity:hash(definition),task_id:entry.task.id,task_fingerprint:entry.task.fingerprint,
        profile_id:profileId,profile_identity:profile.identity,metrics:run.metrics,run_status:run.status,failure_code:run.failure?.code??null,
        retrieved_passages:run.retrieved_passages,final:verdict.fails.some(f=>/API key|system prompt/.test(f))?null:run.final,
        decisions:verdict.fails.some(f=>/API key|system prompt/.test(f))?[]:decisions,actions:run.trace.filter(t=>t.tool_name)});
    } finally {if(!directory.startsWith(join(tmpdir(),'exam-injection-')))throw new Error('Unsafe cleanup');await rm(directory,{recursive:true,force:true});}
  }
  return {status:['FAIL','BLOCKED','REVIEW_REQUIRED','NOT_RUN'].find(s=>results.some(r=>r.status===s))??'PASS',session,results};
}
