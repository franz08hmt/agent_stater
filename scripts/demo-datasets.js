// Minimal independent demo/evaluation for the new read tool. Uses an alternate
// validated task and temporary storage; never rewrites task.json, .env or var/.
// Default: scripted model. --live: the existing LOCAL provider only (no cloud quota).
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config/agent.config.js';
import { loadTaskConfig } from '../config/task.config.js';
import { createModel } from '../src/model/index.js';
import { createScriptedModel } from '../src/model/mock.js';
import { createApp } from '../src/app.js';
import { createQueryDatasetTool } from '../src/tools/queryDataset.js';
import { evaluateDatasetDemo } from './datasetDemoChecks.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const live = process.argv.includes('--live');
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice('--only='.length);
const repeat = Number(process.argv.find((arg) => arg.startsWith('--repeat='))?.slice('--repeat='.length) ?? '1');
if (only !== undefined && !['products', 'classes'].includes(only)) throw new Error('--only must be products or classes.');
if (!Number.isInteger(repeat) || repeat < 1 || repeat > 5) throw new Error('--repeat must be an integer from 1 to 5.');
if (live && existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const config = loadConfig();
if (live && (config.model.provider === 'mock' || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.model.baseUrl).hostname))) {
  throw new Error('Live dataset demo requires a configured local real model; cloud calls are disabled in this script.');
}
const task = await loadTaskConfig({ root, file: join(root, 'config/datasets-demo.task.json') });
const cases = [
  {
    goal: 'Tính tổng price của sản phẩm category stationery trong products (không nhân stock).',
    args: { dataset_id: 'products', operation: 'sum', field: 'price', filters: [{ field: 'category', op: 'eq', value: 'stationery' }] },
    expected: '30.30', answerSpec: { label: 'stationery' }, scriptedAnswer: 'stationery = 30.30.',
    answerInstruction: 'Chỉ viết answer theo dạng: stationery = <tổng>.',
  },
  {
    goal: 'Đếm số lớp có day Mon trong classes.',
    args: { dataset_id: 'classes', operation: 'count', filters: [{ field: 'day', op: 'eq', value: 'Mon' }] },
    expected: 2, answerSpec: { label: 'Mon', unit: 'lớp' }, scriptedAnswer: 'Mon = 2 lớp.',
    answerInstruction: 'Chỉ viết answer theo dạng: Mon = <số lớp> lớp.',
  },
  {
    goal: 'So sánh tổng students của các lớp day Mon với day Tue trong classes; nêu hai tổng.',
    args: { dataset_id: 'classes', operation: 'compare', field: 'students', filters: [{ field: 'day', op: 'eq', value: 'Mon' }], compare_filters: [{ field: 'day', op: 'eq', value: 'Tue' }] },
    expected: ['55', '40'], answerSpec: { groups: ['Mon', 'Tue'] }, scriptedAnswer: 'Mon = 55; Tue = 40; Mon > Tue.',
    answerInstruction: 'Chỉ viết answer theo dạng: Mon = <tổng>; Tue = <tổng>; Mon <dấu so sánh> Tue. Dấu so sánh là một trong <, =, >.',
  },
];
// Reference evidence comes from the same validated snapshot but the intended query,
// independent of the query chosen by the model. Check citation, not just answer tokens.
const referenceTool = createQueryDatasetTool(task.datasets);
for (const c of cases) {
  c.expectedEvidence = (await referenceTool.execute(c.args)).results[0];
  assert.deepEqual(c.expectedEvidence.values ?? c.expectedEvidence.value, c.expected);
}
const selected = cases.filter((c) => only === undefined || c.args.dataset_id === only);
const scenarios = Array.from({ length: repeat }, () => selected).flat();
const replies = scenarios.flatMap((c) => [
  { type: 'tool_call', tool: 'query_dataset', arguments: c.args },
  (messages) => {
    const message = messages.findLast((m) => m.content.startsWith('OBSERVATION'));
    const obs = JSON.parse(message.content.slice(message.content.indexOf('{')));
    assert.equal(obs.status, 'ok');
    const evidence = obs.untrusted_data.results[0];
    assert.deepEqual(evidence.values ?? evidence.value, c.expected);
    return { type: 'final', answer: c.scriptedAnswer, source_ids: [evidence.source_id], unresolved: '' };
  },
]);
const model = live ? createModel(config.model) : createScriptedModel(replies);
const dir = await mkdtemp(join(tmpdir(), 'dataset-demo-'));
try {
  const { runner, store } = await createApp({ config, model, task, varDir: dir, publicDir: join(root, 'public') });
  let passed = 0, failed = 0, reviewRequired = 0;
  console.log(`Dataset demo: ${live ? `LOCAL LLM ${model.name}` : 'SCRIPTED MOCK (backend evidence)'}`);
  for (const c of scenarios) {
    const start = await runner.startRun(`${c.goal} ${c.answerInstruction}`);
    await runner.idle(start.run_id);
    const run = runner.getRun(start.run_id);
    const actions = run.trace.filter((entry) => entry.kind === 'tool');
    const stored = (await store.loadRuns()).find((entry) => entry.run_id === run.run_id);
    const observations = stored.messages.filter((m) => m.role === 'user' && m.content.startsWith('OBSERVATION'))
      .map((m) => JSON.parse(m.content.slice(m.content.indexOf('{'))));
    const verdict = evaluateDatasetDemo({ run, observations, expectedEvidence: c.expectedEvidence, answerSpec: c.answerSpec });
    console.log(JSON.stringify({ ...verdict, goal: c.goal, actions: actions.map(({ tool_name, status, arguments: args }) => ({ tool_name, status, arguments: args })), final: run.final, failure: run.failure, metrics: run.metrics }));
    if (verdict.status === 'PASS') passed++;
    else if (verdict.status === 'REVIEW_REQUIRED') reviewRequired++;
    else failed++;
    // Stop live calls immediately when the provider failed.
    if (live && run.failure?.code.startsWith('model_')) break;
  }
  assert.deepEqual(await store.listDrafts(), []);
  process.exitCode = failed ? 1 : reviewRequired ? 3 : 0;
  console.log(`${passed}/${scenarios.length} PASS, ${failed} FAIL, ${reviewRequired} REVIEW_REQUIRED. PASS checks exact evidence and the supported answer form only. ${live ? 'Broader language meaning still requires manual review.' : 'Scripted mock does not verify a real LLM.'}`);
} finally { await rm(dir, { recursive: true, force: true }); }
