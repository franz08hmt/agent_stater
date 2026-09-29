// Live smoke test for the REAL model configured in .env. Kept separate from the
// test suite on purpose: it needs network and credentials, costs a few requests,
// and its result is evidence about the model, not about the runner.
//   npm run smoke:live

import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config/agent.config.js';
import { createModel } from '../src/model/index.js';
import { createAgentRunner } from '../src/agent/runner.js';
import { createToolRegistry } from '../src/tools/registry.js';
import { createKeywordRetriever } from '../src/retrieval/keywordSearch.js';
import { createFileStore } from '../src/store/fileStore.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const config = loadConfig();
if (config.model.provider === 'mock') {
  console.error('MODEL_PROVIDER is "mock". Set MODEL_PROVIDER=openai-compatible and the MODEL_* values in .env first.');
  process.exit(2);
}
const model = createModel(config.model);
console.log(`Model: ${model.name} @ ${config.model.baseUrl}  (key ${config.model.apiKey ? 'set' : 'not set'})`);

// 1. One raw call: is the endpoint reachable, and does it return parseable JSON?
const t0 = Date.now();
let reachable = true;
try {
  const { text } = await model.complete({
    messages: [{ role: 'system', content: 'Reply with a JSON object only.' }, { role: 'user', content: 'Return {"ok": true}.' }],
    signal: AbortSignal.timeout(config.model.timeoutMs),
  });
  let parsed = null;
  try { parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { /* reported below */ }
  console.log(`1) raw call: ${Date.now() - t0} ms · JSON ${parsed ? 'OK' : `NOT PARSEABLE: ${text.slice(0, 120)}`}`);
} catch (err) {
  console.error(`1) raw call FAILED after ${Date.now() - t0} ms: [${err.kind || 'error'}] ${err.message}`);
  // No process.exit() here: on Windows it can abort Node while the socket is still closing.
  reachable = false;
  process.exitCode = 1;
}
if (reachable) await agentRuns();

async function agentRuns() {
  // 2. Full agent runs through the same runner the server uses.
  const dir = await mkdtemp(join(tmpdir(), 'agent-smoke-'));
  const runner = createAgentRunner({
    model, registry: createToolRegistry(), store: await createFileStore({ root: dir }),
    retriever: await createKeywordRetriever({ dir: join(root, 'data', 'notes') }),
    limits: config.limits, modelTimeoutMs: config.model.timeoutMs,
  });
  const goals = ['401 và 403 khác nhau thế nào?', 'Tổng tỉ trọng điểm giữa kỳ và đồ án cuối kỳ là bao nhiêu phần trăm?', 'Phòng thi giữa kỳ ở đâu?'];
  let ok = true;
  for (const goal of goals) {
    const t = Date.now();
    const start = await runner.startRun(goal);
    await runner.idle(start.run_id);
    const run = runner.getRun(start.run_id);
    const actions = run.trace.filter((x) => x.kind === 'tool' || x.kind === 'approval').map((x) => `${x.tool_name}(${JSON.stringify(x.arguments)})→${x.status}`);
    console.log(`\n2) ${goal}\n   status=${run.status}${run.failure ? ` ${run.failure.code}: ${run.failure.message}` : ''} · ${Date.now() - t} ms · tool calls=${run.steps_used} · repairs=${run.repairs_used}`);
    console.log(`   actions: ${actions.join(' | ') || '(none)'}`);
    if (run.final) console.log(`   sources: [${run.final.source_ids.join(', ')}] · unresolved: ${run.final.unresolved || '—'}\n   answer: ${run.final.answer.replace(/\s+/g, ' ').slice(0, 220)}`);
    if (run.status !== 'completed') ok = false;
  }
  await rm(dir, { recursive: true, force: true });
  console.log(`\nSmoke test ${ok ? 'finished: all runs completed' : 'finished with problems — read the lines above'}. Judge answer quality yourself; "completed" only means the loop ended properly.`);
  process.exitCode = ok ? 0 : 1;
}
