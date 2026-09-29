// `npm run eval:live` against a provider that always answers 429. The real script runs as a child
// process; the fake provider counts what it receives. This is the offline proof that a quota
// failure is reported as BLOCKED and that no further requests are sent.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from './helpers.js';

function runEval(args, env) {
  return new Promise((resolve) => {
    execFile(process.execPath, [join(ROOT, 'eval', 'run-eval.js'), ...args], { cwd: ROOT, env: { ...process.env, ...env }, timeout: 60000 }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr });
    });
  });
}

test('eval:live stops at the first 429: that case is BLOCKED, the rest are not attempted, and only one request is sent', async (t) => {
  let hits = 0;
  const server = createServer((req, res) => {
    hits += 1;
    req.resume();
    res.writeHead(429, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 429, details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));

  const { code, stdout } = await runEval(['--live', '--only=E01,E02,E10,E16'], {
    MODEL_PROVIDER: 'openai-compatible',
    MODEL_BASE_URL: `http://127.0.0.1:${server.address().port}/v1/`,
    MODEL_NAME: 'fake-model',
    MODEL_API_KEY: 'sk-fake-guard-test-key',
    EVAL_LIVE_PACE_MS: '0',
  });

  const line = (id) => stdout.split('\n').find((l) => l.includes(id));
  assert.match(line('E01'), /^BLOCKED\s+E01.*model_rate_limited.*quotaId=GenerateRequestsPerDayPerProjectPerModel-FreeTier/);
  for (const id of ['E02', 'E10', 'E16']) assert.match(line(id), /^BLOCKED\s+E\d\d.*not attempted: model_rate_limited/, `${id} must be marked as not attempted`);
  assert.match(stdout, /4 blocked by the provider/);
  assert.match(stdout, /no further requests were sent/);
  assert.doesNotMatch(stdout, /\bPASS\b\s+E\d\d/, 'nothing may be reported as PASS');
  assert.equal(hits, 1, 'exactly one request reached the provider');
  assert.equal(code, 3, 'exit code 3 = nothing failed, but something could not be concluded');
});

test('input-only cases still run when the provider is down, because they need no model', async (t) => {
  const server = createServer((req, res) => { req.resume(); res.writeHead(429); res.end('{}'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const { stdout } = await runEval(['--live', '--only=E01,E05,E06'], {
    MODEL_PROVIDER: 'openai-compatible', MODEL_BASE_URL: `http://127.0.0.1:${server.address().port}/v1/`, MODEL_NAME: 'fake', EVAL_LIVE_PACE_MS: '0',
  });
  assert.match(stdout, /^BLOCKED\s+E01/m);
  assert.match(stdout, /^PASS\s+E05/m);
  assert.match(stdout, /^PASS\s+E06/m);
});
