import { randomUUID } from 'node:crypto';
import { createMetrics, planRequest, startRequest, settleRequest } from '../agent/metrics.js';
import { createOpenAICompatibleModel } from './openaiCompatible.js';

export async function probeProfile(profile) {
  const metrics = createMetrics({ maxProviderRequests: 1, tokenBudget: 4096 }, profile.metadata.is_mock);
  const started = Date.now();
  const probe = { probe_id: `probe_${randomUUID()}`, model_profile_id: profile.id, checked_at: new Date().toISOString(),
    is_mock: profile.metadata.is_mock, endpoint_responded: false, protocol_ok: false, error: null, metrics };
  if (!profile.model) { probe.error = { code: 'profile_unavailable', message: profile.metadata.reason }; return probe; }
  const messages = [{ role: 'system', content: 'Connectivity probe only. Return exactly {"ok":true} as JSON.' }, { role: 'user', content: 'Return {"ok":true}.' }];
  const requestControl = {
    beforeRequest: (msgs, cap) => planRequest(metrics, msgs, cap),
    requestStarted: (p, retry) => startRequest(metrics, p, retry),
    requestFinished: (p, usage, ms) => settleRequest(metrics, p, usage, ms),
  };
  try {
    if (profile.metadata.is_mock) {
      // Explicit simulation of the probe protocol, never a claim about HTTP reachability.
      const p = planRequest(metrics, messages, 64); metrics.model_calls++;
      startRequest(metrics, p, false); settleRequest(metrics, p, null, 0); probe.protocol_ok = true;
    } else {
      const model = createOpenAICompatibleModel({ ...profile.config, maxOutputTokens: 64 });
      metrics.model_calls++;
      const { text } = await model.complete({ messages, signal: AbortSignal.timeout(Math.min(5000, profile.config.timeoutMs)), requestControl, retry: false });
      probe.endpoint_responded = true;
      try { const value = JSON.parse(text); probe.protocol_ok = value?.ok === true && Object.keys(value).length === 1; } catch { /* malformed protocol */ }
      if (!probe.protocol_ok) probe.error = { code: 'invalid_protocol', message: 'Endpoint responded but the probe JSON protocol was invalid.' };
    }
  } catch (err) {
    probe.endpoint_responded = Number.isInteger(err.status);
    probe.error = { code: err.kind || 'model_error', message: err.kind === 'timeout' ? 'Probe timed out.' : `Probe failed: ${err.kind || 'model_error'}.` };
  }
  metrics.model_ms = Date.now() - started; metrics.active_ms = metrics.model_ms; metrics.wall_ms = metrics.model_ms;
  return probe;
}
