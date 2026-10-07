import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMetrics, validateUsage, planRequest, startRequest, settleRequest, estimateInput } from '../src/agent/metrics.js';

test('usage is an exact, coherent nonnegative integer triple, not coerced', () => {
  assert.deepEqual(validateUsage({ prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 }), { input: 7, output: 3, total: 10 });
  for (const usage of [null, {}, { total_tokens: 10 }, { prompt_tokens: '', completion_tokens: 3, total_tokens: 3 }, { prompt_tokens: -1, completion_tokens: 3, total_tokens: 2 }, { prompt_tokens: Infinity, completion_tokens: 0, total_tokens: Infinity }, { prompt_tokens: 1, completion_tokens: NaN, total_tokens: 1 }, { prompt_tokens: 1.5, completion_tokens: 2, total_tokens: 3.5 }, { prompt_tokens: 2, completion_tokens: 3, total_tokens: 6 }]) assert.equal(validateUsage(usage), null);
});

test('reported usage accumulates; missing usage keeps reservation and becomes mixed', () => {
  const m = createMetrics({}, false);
  const messages = [{ role: 'user', content: 'hello' }];
  for (let i = 0; i < 2; i++) {
    const p = planRequest(m, messages, 100);
    startRequest(m, p, i === 1);
    settleRequest(m, p, { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 }, 4);
  }
  assert.deepEqual(m.tokens.reported, { input: 14, output: 6, total: 20 });
  assert.equal(m.provider_requests, 2);
  assert.equal(m.retries, 1);
  assert.equal(m.tokens.status, 'provider reported');
  const p = planRequest(m, messages, 100);
  startRequest(m, p, false);
  settleRequest(m, p, null, 2);
  assert.equal(m.tokens.status, 'mixed');
  assert.equal(m.tokens.unavailable_requests, 1);
  assert.equal(m.tokens.budget_used, 20 + p.total);
});

test('missing and invalid usage stay unknown, including a failed request', () => {
  for (const usage of [null, { total_tokens: 7 }]) {
    const m = createMetrics({}, false);
    const p = planRequest(m, [], 100);
    startRequest(m, p, false);
    settleRequest(m, p, usage, 3);
    assert.equal(m.tokens.reported.total, null);
    assert.equal(m.tokens.status, 'estimated');
    assert.equal(m.tokens.estimated.total, p.total);
    assert.equal(m.tokens.invalid_usage_requests, usage ? 1 : 0);
  }
});

test('token preflight refuses insufficient reservation and reduces output cap to fit', () => {
  const messages = [{ role: 'user', content: 'hello' }];
  const input = estimateInput(messages);
  const low = createMetrics({ tokenBudget: input + 63 }, false);
  assert.throws(() => planRequest(low, messages, 100), { code: 'token_budget' });
  const enough = createMetrics({ tokenBudget: input + 70 }, false);
  assert.equal(planRequest(enough, messages, 100).output, 70);
});

test('request budget is hard and mock reservations never count as HTTP', () => {
  const m = createMetrics({ maxProviderRequests: 1 }, false);
  const p = planRequest(m, [], 100);
  startRequest(m, p, false);
  assert.throws(() => planRequest(m, [], 100), { code: 'request_budget' });
  const mock = createMetrics({}, true);
  const mp = planRequest(mock, [], 100);
  startRequest(mock, mp, false);
  settleRequest(mock, mp, null, 0);
  assert.equal(mock.provider_requests, 0);
  assert.equal(mock.tokens.status, 'estimated');
  assert.equal(mock.tokens.reported.total, null);
});
