// Evaluation runner.
//   npm run eval                      -> every case with deterministic mocks (repeatable, offline)
//   npm run eval:live                 -> "policy" and "input" cases against the real model in .env;
//                                        "script" cases are skipped (a real model cannot be forced to
//                                        produce a specific malformed reply or timeout)
//   npm run eval:live -- --only=E10,E11,E16   -> just those cases
//
// Mock results prove the runner; only --live results say anything about the real model.
// Verdicts are decided in eval/checks.js. Statuses: PASS, FAIL, INCONCLUSIVE, BLOCKED, SKIP.
// BLOCKED = the provider failed (quota, auth, network). The first such failure stops the live
// session: the remaining live cases are NOT attempted, so a quota is never spent for nothing.

import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config/agent.config.js';
import { loadTaskConfig } from '../config/task.config.js';
import { buildSystemPrompt } from '../config/prompts.js';
import { createModel } from '../src/model/index.js';
import { createRuleBasedMock, createScriptedModel } from '../src/model/mock.js';
import { createAgentRunner } from '../src/agent/runner.js';
import { createConfiguredToolRegistry } from '../src/tools/registry.js';
import { createKeywordRetriever } from '../src/retrieval/keywordSearch.js';
import { createFileStore } from '../src/store/fileStore.js';
import { evaluateCase, isProviderFailure } from './checks.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const live = process.argv.includes('--live');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const config = loadConfig();
const task = await loadTaskConfig({ root });
if (live && config.model.provider === 'mock') {
  console.error('eval:live needs MODEL_PROVIDER=openai-compatible in .env (see README → "3. Cấu hình model").');
  process.exit(2);
}
const liveModel = live ? createModel(config.model) : null;
const allCases = JSON.parse(await readFile(join(root, 'eval', 'cases.json'), 'utf8')).cases;
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length).split(',') : null;
const cases = only ? allCases.filter((c) => only.includes(c.id)) : allCases;
const retriever = await createKeywordRetriever({ dir: task.dataDir });

const registry = createConfiguredToolRegistry(task.allowedTools);
const env = {
  registry,
  systemPrompt: buildSystemPrompt({ task, tools: registry.describe(), limits: config.limits }),
  apiKey: config.model.apiKey,
};

async function runCase(c) {
  if (c.mode === 'script' && live) return { status: 'SKIP', note: 'mock-only (forced failure)' };
  const dir = await mkdtemp(join(tmpdir(), 'agent-eval-'));
  try {
    const store = await createFileStore({ root: dir });
    const model = c.mode === 'script' ? createScriptedModel(c.script.map((r) => (r.delayMs || r.error ? r : typeof r === 'string' ? r : JSON.stringify(r))))
      : live ? liveModel : createRuleBasedMock();
    let modelCalls = 0;
    const counted = { ...model, complete: (args) => { modelCalls += 1; return model.complete(args); } };
    const runner = createAgentRunner({
      model: counted, registry, retriever, store,
      limits: { ...config.limits, ...(c.limits || {}) },
      modelTimeoutMs: c.model_timeout_ms || config.model.timeoutMs, task,
    });
    const goal = c.goal_repeat ? c.goal_repeat.text.repeat(c.goal_repeat.times) : c.goal;
    const ctx = { modelCalls: 0, drafts: 0, replayed: false, error: null };
    let run = null;
    const started = Date.now();
    try {
      run = await runner.startRun(goal);
      await runner.idle(run.run_id);
      run = runner.getRun(run.run_id);
      for (const decision of c.actions || []) {
        const a = run.approvals.find((x) => x.approval_id === run.pending_approval) || run.approvals.at(-1);
        if (!a) break;
        const res = await runner.decideApproval(run.run_id, a.approval_id, { decision, args_hash: a.args_hash });
        if (res.replayed) ctx.replayed = true;
        await runner.idle(run.run_id);
        run = runner.getRun(run.run_id);
      }
    } catch (err) {
      ctx.error = err.code || err.message;
    }
    ctx.modelCalls = modelCalls;
    ctx.drafts = (await store.listDrafts()).length;

    const detail = run && {
      status: run.status, failure: run.failure, steps_used: run.steps_used, final: run.final,
      retrieved_passages: run.retrieved_passages,
      trace: run.trace.map((t) => `${t.kind}:${t.tool_name || ''}:${t.status}`),
    };
    if (live && c.mode === 'policy' && isProviderFailure(run)) {
      return { status: 'BLOCKED', providerFailure: true, note: `${run.failure.code}: ${run.failure.message.slice(0, 190)}`, ms: Date.now() - started, run: detail };
    }
    const verdict = evaluateCase(c, run, ctx, env);
    return { status: verdict.status, note: [...verdict.fails, ...verdict.info.map((i) => `(${i})`)].join('; '), ms: Date.now() - started, run: detail };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const label = live ? `LIVE · ${liveModel.provider} · ${liveModel.name}` : 'MOCK (runner evidence only — not LLM evidence)';
console.log(`\nEvaluation — ${label}\n`);
// Free hosted tiers allow only a few requests per minute; space live cases out.
const paceMs = live ? Number(process.env.EVAL_LIVE_PACE_MS ?? 15000) : 0;
const results = [];
let providerDown = null;   // set by the first provider failure; stops further live model calls
for (const c of cases) {
  let r;
  if (providerDown && live && c.mode === 'policy') {
    r = { status: 'BLOCKED', note: `not attempted: ${providerDown}`, notAttempted: true };
  } else {
    if (paceMs && results.some((x) => x.status !== 'SKIP' && !x.notAttempted) && c.mode === 'policy') await new Promise((res) => setTimeout(res, paceMs));
    r = await runCase(c);
    if (r.providerFailure) providerDown = r.note.split(':')[0];
  }
  results.push({ id: c.id, title: c.title, mode: c.mode, ...r });
  console.log(`${r.status.padEnd(12)}${c.id}  ${c.title}${r.note ? `  — ${r.note}` : ''}`);
}
const count = (s) => results.filter((r) => r.status === s).length;
console.log(`\n${count('PASS')} passed, ${count('FAIL')} failed, ${count('INCONCLUSIVE')} inconclusive, ${count('BLOCKED')} blocked by the provider, ${count('SKIP')} skipped of ${results.length}.`);
if (providerDown) console.log(`Live session stopped after the first provider failure (${providerDown}); no further requests were sent.`);
await mkdir(join(root, 'var'), { recursive: true });
const out = join(root, 'var', `eval-${live ? 'live' : 'mock'}${only ? `-${only.join('-')}` : ''}.json`);
await writeFile(out, JSON.stringify({ mode: label, at: new Date().toISOString(), results }, null, 2));
console.log(`Details: ${out}`);
// 0 = all conclusive passes; 1 = a failure; 3 = nothing failed but something could not be concluded.
process.exitCode = count('FAIL') ? 1 : count('BLOCKED') || count('INCONCLUSIVE') ? 3 : 0;
