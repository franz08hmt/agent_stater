import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRunMetrics } from '../public/run-metrics.js';

test('token details label reported input/output separately from estimated reservations', () => {
  const metrics = { collection: 'collected', tokens: { reported: { input: 30, output: 8, total: 38 }, estimated: { total: 200 }, budget_used: 238, status: 'mixed' },
    limits: { provider_requests: 5, token_budget: 1000 }, provider_requests: 2, model_calls: 2, repairs: 0, retries: 0,
    model_ms: 200, approval_wait_ms: 1000, wall_ms: 1200, is_mock: false };
  assert.equal(formatRunMetrics(metrics).breakdown, 'Provider reported input 30 / output 8; estimated / reserved 200');
  metrics.tokens.reported = { input: null, output: null, total: null };
  assert.match(formatRunMetrics(metrics).breakdown, /input unavailable \/ output unavailable/);
  assert.doesNotMatch(formatRunMetrics(metrics).tokens, /0 provider reported/);
  assert.equal(formatRunMetrics(null).breakdown, 'Unavailable — not collected');
});
