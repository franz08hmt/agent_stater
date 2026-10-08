import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adaptationSession } from '../src/operations/adaptationVerify.js';
import { createMetrics, planRequest, startRequest, settleRequest } from '../src/agent/metrics.js';

test('adaptation shared cap rejects every next request including retry before send; no refunds or unaccounted calls', async () => {
  assert.throws(() => adaptationSession(49), /1..48/);
  const campaign = adaptationSession(1), metrics = createMetrics({ maxProviderRequests: 3, tokenBudget: 20000 }, false);
  let sent = 0;
  const provider = { async complete({ requestControl }) {
    for (const retry of [false, true]) {
      const plan = requestControl.beforeRequest([], 800);
      sent++; requestControl.requestStarted(plan, retry); requestControl.requestFinished(plan, null, 2);
    }
  } };
  const control = { beforeRequest: (msgs, cap) => planRequest(metrics, msgs, cap), requestStarted: (p, retry) => startRequest(metrics, p, retry), requestFinished: (p, usage, ms) => settleRequest(metrics, p, usage, ms) };
  await assert.rejects(campaign.wrap(provider).complete({ requestControl: control }), { code: 'session_request_budget' });
  assert.equal(sent, 1); assert.equal(campaign.session.used, 1); assert.equal(metrics.provider_requests, 1);
  assert.equal(metrics.retries, 0); assert.equal(metrics.tokens.unavailable_requests, 1);
  await assert.rejects(campaign.wrap(provider).complete({ requestControl: control }), { code: 'session_request_budget' });
  assert.equal(sent, 1);
  assert.throws(() => campaign.wrap(provider).complete({}), /Accounting/);
});
