import { mkdtemp, cp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadEnvironment } from '../src/operations/context.js';
import { loadCatalog } from '../config/catalog.config.js';
import { scaffoldProject } from '../src/scaffold/apply.js';
import { runAcceptanceTask, gradeReadEvidence } from '../src/scaffold/acceptance.js';
import { createApp } from '../src/app.js';
import { createFollowups } from '../src/agent/followups.js';
import { adaptationSession } from '../src/operations/adaptationVerify.js';
import { inspectLocalModel, localEndpoint } from '../src/operations/localModel.js';
import { campaignCheck, summarizeMetrics } from '../src/operations/campaign.js';
import { gradeProposal, proposalObservations } from '../src/operations/proposalSuite.js';
import { sanitizeEvidence } from '../src/operations/reports.js';

const args = process.argv.slice(2);
if (args.some(a => a !== '--live' && !/^--cap=(?:[1-9]|[1-3][0-9]|4[0-8])$/.test(a))) throw new Error('Only --live and --cap=1..48 are supported; fixed local profile ollama-qwen3.');
const live = args.includes('--live'), cap = Number(args.find(a => a.startsWith('--cap='))?.slice(6) || 48);
const env = await loadEnvironment(), directory = join(env.root, 'var', 'adaptation-kit-20261008', `verification-${randomUUID()}`);
await mkdir(directory, { recursive: false });
const temporary = await mkdtemp(join(tmpdir(), 'adaptation-verify-'));
const results = [], checks = []; let inspection;
const campaign = adaptationSession(cap), started = Date.now();
try {
  for (const folder of ['config', 'data']) await cp(join(env.root, folder), join(temporary, folder), { recursive: true });
  const spec = JSON.parse(await readFile(new URL('../templates/asset-loan.spec.json', import.meta.url), 'utf8'));
  await scaffoldProject({ root: temporary, spec, register: true });
  await scaffoldProject({ root: temporary, spec, register: true, apply: true });
  const offline = await runAcceptanceTask({ root: temporary, id: spec.task.id });
  await writeFile(join(directory, 'offline.json'), JSON.stringify(offline, null, 2));
  if (offline.status !== 'PASS') throw new Error('Independent asset acceptance failed.');
  if (live) {
    // A concurrent author's untracked documentation is retained, never committed
    // here. Refuse executable/data edits while recording the full dirty flag.
    const executableChanges = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', 'src', 'config', 'data', 'eval', 'scripts/verify-adaptation.js', 'templates/asset-loan.spec.json'], { cwd: env.root, encoding: 'utf8' }).trim();
    if (executableChanges) throw new Error('Commit the reviewed runtime/data before live verification.');
    const catalog = await loadCatalog({ root: temporary, config: env.config }), profile = catalog.profiles.get('ollama-qwen3');
    localEndpoint(profile); inspection = await inspectLocalModel(profile);
    if (inspection.status !== 'PASS') throw new Error('Local model unavailable; no model request sent.');
    for (const kind of ['warm', 'probe']) { const check = await campaignCheck(campaign.session, profile, kind); checks.push(check); console.log(JSON.stringify({ kind, status: check.status, requests: campaign.session.used })); }
    profile.model = campaign.wrap(profile.model);
    const app = await createApp({ config: env.config, catalog, varDir: join(directory, 'store'), publicDir: new URL('../public', import.meta.url).pathname.replace(/^\/(\w:)/, '$1') });
    const followups = createFollowups({ catalog, store: app.store }); await followups.init();
    const read = (id, goal) => ({ id, task_id: 'datasets-demo', goal, tool: 'query_dataset', args: { dataset_id: 'products', operation: 'sum', field: 'price', filters: [{ field: 'category', op: 'eq', value: 'stationery' }] }, expected: { matched_count: 2, value: '30.30' } });
    const cases = [
      read('read-vi-vi', 'Tính tổng price của products có category stationery. Giải thích kết quả bằng tiếng Việt.'),
      read('read-en-en', 'Sum price of products with category stationery. Explain the result in English.'),
      read('read-vi-en', 'Tính tổng price của products có category stationery. Giải thích bằng tiếng Anh.'),
      read('read-en-vi', 'Sum price of products with category stationery. Explain in Vietnamese.'),
      ...['vi', 'en'].flatMap(language => ['approve', 'reject'].map(decision => ({ id: `proposal-${language}-${decision}`, task_id: 'proposal-tickets', decision,
        goal: language === 'vi' ? 'Tạo đề xuất đổi status của ticket T2 thành closed. Báo kết quả phê duyệt bằng tiếng Việt.' : 'Create a proposal to change ticket T2 status to closed. Report approval outcome in English.',
        action: 'ticket_status', references: [{ role: 'subject', dataset_id: 'tickets', record_id: 'T2' }], changes: { status: 'closed' } }))),
      { ...spec.cases.find(c => c.id === 'available'), id: 'asset-read', task_id: spec.task.id },
      ...spec.cases.filter(c => c.kind === 'proposal' && ['approve', 'insufficient'].includes(c.id)).map(c => ({ ...c, id: `asset-${c.id}`, task_id: spec.task.id })),
    ];
    // IDs in the authored asset manifest are authoritative; never derive expected from tool output.
    for (const c of cases.filter(c => c.goal)) {
      if (campaign.session.used >= cap) { results.push({ id: c.id, status: 'NOT_RUN', reason: 'Campaign cap exhausted.' }); continue; }
      const run = await app.runner.startRun(c.goal, { task_id: c.task_id, model_profile_id: 'ollama-qwen3' }); await app.runner.idle(run.run_id);
      let view = app.runner.getRun(run.run_id), replayed = false;
      const blocked = c.expected?.outcome === 'blocked';
      if (view.status === 'awaiting_approval') {
        if (blocked) await app.runner.stopRun(view.run_id);
        else {
          const a = view.approvals.at(-1), body = { decision: c.decision, args_hash: a.args_hash };
          await app.runner.decideApproval(view.run_id, a.approval_id, body); await app.runner.idle(view.run_id);
          replayed = (await app.runner.decideApproval(view.run_id, a.approval_id, body)).replayed;
        }
        view = app.runner.getRun(run.run_id);
      }
      const stored = (await app.store.loadRuns()).find(r => r.run_id === run.run_id), task = catalog.tasks.get(c.task_id).task;
      const observations = proposalObservations(stored.messages), evidence = observations.filter(o => o.status === 'ok' && o.tool === c.tool).flatMap(o => o.untrusted_data?.results || []);
      let verdict;
      if (c.action) verdict = await gradeProposal({ ...c, blocked, rule: c.expected?.error_contains }, view, stored, task, (await app.store.listProposals(50)).filter(p => p.run_id === run.run_id), replayed);
      else {
        const failures = view.final ? gradeReadEvidence(c, view, evidence, task.datasets) : ['No valid final.'];
        if (view.final && !/(^|[^\d])30\.30([^\d]|$)/.test(view.final.answer) && c.id.startsWith('read-')) failures.push('Expected whole numeric value 30.30 missing.');
        verdict = { status: view.failure?.code?.includes('budget') ? 'BLOCKED' : failures.length || view.status !== 'completed' ? 'FAIL' : 'REVIEW_REQUIRED', reason: failures.join('; ') || 'Evidence checked; manually assess goal language and prose.' };
      }
      results.push({ id: c.id, ...verdict, goal: c.goal, run_id: run.run_id, task_id: task.id, task_fingerprint: task.fingerprint, profile_identity: profile.identity,
        metrics: view.metrics, final: view.final, failure: view.failure, approvals: view.approvals, trace: view.trace, replayed, dataset_unchanged: await task.verifyCurrent() });
      console.log(JSON.stringify({ id: c.id, status: verdict.status, requests: campaign.session.used, answer: view.final?.answer, error: view.failure?.code }));
      if (c.id === 'read-vi-vi' && view.final) {
        for (const request of ['Translate the previous answer into English.', 'Nói ngắn gọn hơn bằng tiếng Việt.']) {
          if (campaign.session.used >= cap) { results.push({ id: 'followup', status: 'NOT_RUN' }); continue; }
          const result = await followups.ask(run.run_id, request);
          results.push({ id: `followup-${results.filter(r => r.id?.startsWith('followup')).length+1}`, ...result, parent_run_id: run.run_id, historical_unchanged: JSON.stringify(app.runner.getRun(run.run_id)) === JSON.stringify(view) });
          console.log(JSON.stringify({ followup: result.status, answer: result.answer, requests: campaign.session.used }));
        }
      }
    }
  }
} catch (error) { results.push({ id: 'campaign', status: 'BLOCKED', reason: error.message }); console.error(error.message); }
finally {
  // Follow-up snapshots are cumulative: retain only the latest per parent for totals.
  const followupTotals = new Map(); for (const r of results) if (r.parent_run_id) followupTotals.set(r.parent_run_id, r);
  const accounting = summarizeMetrics([...checks, ...results.filter(r => !r.parent_run_id), ...followupTotals.values()]);
  const report = sanitizeEvidence({ checked_at: new Date().toISOString(), identity: env.evidenceContext, scope: 'temporary_scaffold_catalog', inspection,
    status: ['FAIL','BLOCKED','REVIEW_REQUIRED','NOT_RUN'].find(s => results.some(r => r.status === s)) || 'PASS', model_evidence: live ? 'LIVE_LOCAL_FINITE' : 'SCRIPTED_EXTENSION_ONLY',
    session: campaign.session, accounting, checks, results, student_adaptation: 'NOT_RUN', elapsed_ms: Date.now()-started }, { root: env.root, secrets: [env.config.model.apiKey].filter(Boolean) });
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2)); console.log(`Evidence: ${directory}`);
  if (!temporary.startsWith(join(tmpdir(), 'adaptation-verify-'))) throw new Error('Unsafe cleanup'); await rm(temporary, { recursive: true, force: true });
}
