// Evaluation runner.
//   npm run eval        -> every case, deterministic mocks (repeatable, offline)
//   npm run eval:live   -> "policy" and "input" cases against the real model from .env;
//                          "script" cases are skipped because a real model cannot be forced
//                          to produce a specific malformed reply or timeout.
// Mock results prove the runner; only --live results say anything about the real model.

import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config/agent.config.js';
import { createModel } from '../src/model/index.js';
import { createRuleBasedMock, createScriptedModel } from '../src/model/mock.js';
import { createAgentRunner } from '../src/agent/runner.js';
import { createToolRegistry } from '../src/tools/registry.js';
import { createKeywordRetriever } from '../src/retrieval/keywordSearch.js';
import { createFileStore } from '../src/store/fileStore.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const live = process.argv.includes('--live');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const config = loadConfig();
if (live && config.model.provider === 'mock') {
  console.error('eval:live needs MODEL_PROVIDER=openai-compatible in .env (see README → "Dùng model thật").');
  process.exit(2);
}
const liveModel = live ? createModel(config.model) : null;
const allCases = JSON.parse(await readFile(join(root, 'eval', 'cases.json'), 'utf8')).cases;
// --only=E10,E11 runs a subset (handy when a free tier rate-limits a full live run).
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length).split(',') : null;
const cases = only ? allCases.filter((c) => only.includes(c.id)) : allCases;
const retriever = await createKeywordRetriever({ dir: join(root, 'data', 'notes') });

function check(c, run, ctx) {
  const e = c.expect, fails = [];
  if (e.error_code) { if (ctx.error !== e.error_code) fails.push(`error ${ctx.error} ≠ ${e.error_code}`); return fails; }
  if (ctx.error) return [`unexpected error ${ctx.error}`];
  const toolTrace = run.trace.filter((t) => t.kind === 'tool');
  if (e.status && run.status !== e.status) fails.push(`status ${run.status}${run.failure ? ` (${run.failure.code})` : ''} ≠ ${e.status}`);
  if (e.failure_code && run.failure?.code !== e.failure_code) fails.push(`failure ${run.failure?.code} ≠ ${e.failure_code}`);
  if (e.steps_used !== undefined && run.steps_used !== e.steps_used) fails.push(`steps ${run.steps_used} ≠ ${e.steps_used}`);
  if (e.model_calls !== undefined && ctx.modelCalls !== e.model_calls) fails.push(`model calls ${ctx.modelCalls} ≠ ${e.model_calls}`);
  for (const id of e.sources_include || []) if (!run.final?.source_ids.includes(id)) fails.push(`missing source ${id}`);
  if (e.sources_empty && run.final?.source_ids.length) fails.push(`expected no sources, got ${run.final.source_ids.join(',')}`);
  if (e.unresolved && !run.final?.unresolved) fails.push('expected a non-empty "unresolved"');
  if (e.tool_statuses && JSON.stringify(toolTrace.map((t) => t.status)) !== JSON.stringify(e.tool_statuses)) fails.push(`tool statuses ${toolTrace.map((t) => t.status)} ≠ ${e.tool_statuses}`);
  if (e.summary_includes && !run.trace.some((t) => (t.summary || '').includes(e.summary_includes))) fails.push(`no trace entry mentions ${e.summary_includes}`);
  if (e.drafts !== undefined && ctx.drafts !== e.drafts) fails.push(`drafts ${ctx.drafts} ≠ ${e.drafts}`);
  if (e.paused_for_approval && !run.approvals.length) fails.push('never paused for approval');
  if (e.replayed && !ctx.replayed) fails.push('second approval was not reported as a replay');
  if (e.only_allowed_tools_ok && toolTrace.some((t) => t.status === 'ok' && !['search_notes', 'save_draft'].includes(t.tool_name))) fails.push('a non-allow-listed tool executed');
  return fails;
}

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
      model: counted, registry: createToolRegistry(), retriever, store,
      limits: { ...config.limits, ...(c.limits || {}) },
      modelTimeoutMs: c.model_timeout_ms || config.model.timeoutMs,
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
    // A live case that died on the provider (quota, network) tells us nothing about the
    // model's behaviour — report it as BLOCKED rather than letting it pass or fail vacuously.
    const blocked = live && c.mode === 'policy' && run?.failure?.code?.startsWith('model_');
    const fails = blocked ? [] : check(c, run, ctx);
    return {
      status: blocked ? 'BLOCKED' : fails.length ? 'FAIL' : 'PASS',
      note: blocked ? `${run.failure.code}: ${run.failure.message.slice(0, 90)}` : fails.join('; '),
      ms: Date.now() - started,
      run: run && { status: run.status, failure: run.failure, steps_used: run.steps_used, final: run.final, trace: run.trace.map((t) => `${t.kind}:${t.tool_name || ''}:${t.status}`) },
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const label = live ? `LIVE · ${liveModel.provider} · ${liveModel.name}` : 'MOCK (runner evidence only — not LLM evidence)';
console.log(`\nEvaluation — ${label}\n`);
// Free hosted tiers allow only a few requests per minute; space live cases out.
const paceMs = live ? Number(process.env.EVAL_LIVE_PACE_MS ?? 15000) : 0;
const results = [];
for (const c of cases) {
  if (paceMs && results.some((r) => r.status !== 'SKIP') && c.mode === 'policy') await new Promise((r) => setTimeout(r, paceMs));
  const r = await runCase(c);
  results.push({ id: c.id, title: c.title, mode: c.mode, ...r });
  console.log(`${r.status.padEnd(4)}  ${c.id}  ${c.title}${r.note ? `  — ${r.note}` : ''}`);
}
const count = (s) => results.filter((r) => r.status === s).length;
console.log(`\n${count('PASS')} passed, ${count('FAIL')} failed, ${count('BLOCKED')} blocked by the provider, ${count('SKIP')} skipped of ${results.length}.`);
await mkdir(join(root, 'var'), { recursive: true });
const out = join(root, 'var', `eval-${live ? 'live' : 'mock'}${only ? `-${only.join('-')}` : ''}.json`);
await writeFile(out, JSON.stringify({ mode: label, at: new Date().toISOString(), results }, null, 2));
console.log(`Details: ${out}`);
process.exitCode = count('FAIL') ? 1 : count('BLOCKED') ? 3 : 0;
