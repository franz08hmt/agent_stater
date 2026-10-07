import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRunMetrics } from '../public/run-metrics.js';
import { createMetrics, planRequest, startRequest, settleRequest } from '../src/agent/metrics.js';
import { loadConfig } from '../config/agent.config.js';

test('UI distinguishes unknown, reported, mixed and mock metrics', () => {
  assert.match(formatRunMetrics(null).tokens, /not collected/);
  const m = createMetrics({}, false);
  assert.match(formatRunMetrics(m).tokens, /Unavailable/);
  const p = planRequest(m, [], 100); startRequest(m, p, false);
  settleRequest(m, p, { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }, 1);
  assert.match(formatRunMetrics(m).tokens, /15 provider reported/);
  const p2 = planRequest(m, [], 100); startRequest(m, p2, false); settleRequest(m, p2, null, 1);
  assert.match(formatRunMetrics(m).tokens, /mixed/);
  assert.match(formatRunMetrics(createMetrics({}, true)).requests, /Mock, no HTTP/);
});

test('budget environment values are validated at startup', () => {
  for (const name of ['AGENT_MAX_PROVIDER_REQUESTS', 'AGENT_TOKEN_BUDGET']) {
    const old = process.env[name];
    try {
      for (const bad of ['-1', '0', '1.5', 'Infinity', 'NaN', '1000000000']) {
        process.env[name] = bad; assert.throws(loadConfig, new RegExp(name));
      }
      process.env[name] = name.includes('REQUESTS') ? '3' : '10000';
      assert.equal(loadConfig().limits[name.includes('REQUESTS') ? 'maxProviderRequests' : 'tokenBudget'], name.includes('REQUESTS') ? 3 : 10000);
    } finally { if (old === undefined) delete process.env[name]; else process.env[name] = old; }
  }
});
