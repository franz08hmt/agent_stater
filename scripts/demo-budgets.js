import assert from 'node:assert/strict';
import { createBudgetDemo } from './budgetDemoFixture.js';

for (const requestLimit of [12, 1]) {
  const app = await createBudgetDemo({ requestLimit });
  try {
    const started = await app.runner.startRun('Explain 401 and 403');
    await app.runner.idle(started.run_id);
    const run = app.runner.getRun(started.run_id);
    assert.equal(run.metrics.provider_requests, app.requests());
    assert.equal(run.status, requestLimit === 1 ? 'stopped' : 'completed');
    assert.equal(app.requests(), requestLimit === 1 ? 1 : 2);
    assert.equal(run.steps_used, 1);
    assert.equal((await app.store.listDrafts()).length, 0);
    if (requestLimit === 1) assert.equal(run.failure.code, 'request_budget');
    console.log(JSON.stringify({ demo: requestLimit === 1 ? 'budget stop' : 'normal', provider: 'FAKE HTTP, no real LLM', status: run.status, failure: run.failure, final: run.final, metrics: run.metrics, actual_http_requests: app.requests() }));
  } finally { await app.close(); }
}
