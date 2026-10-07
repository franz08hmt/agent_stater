// Per-run accounting. Estimates are reservations, never a claim about billed tokens.
export const DEFAULT_BUDGETS = Object.freeze({ maxProviderRequests: 12, tokenBudget: 100000 });
export class BudgetError extends Error {
  constructor(code, message) { super(message); this.kind = 'budget'; this.code = code; }
}

export function createMetrics(limits, isMock) {
  return {
    version: 1, collection: 'collected', is_mock: !!isMock,
    limits: { provider_requests: limits.maxProviderRequests ?? DEFAULT_BUDGETS.maxProviderRequests, token_budget: limits.tokenBudget ?? DEFAULT_BUDGETS.tokenBudget },
    model_calls: 0, provider_requests: 0, repairs: 0, retries: 0,
    model_ms: 0, provider_ms: 0, active_ms: 0, approval_wait_ms: 0, wall_ms: 0,
    model_started_at: null, approval_wait_started_at: null, timing_incomplete: false,
    tokens: { reported: { input: null, output: null, total: null }, estimated: { input: 0, output: 0, total: 0 }, budget_used: 0,
      reported_requests: 0, unavailable_requests: 0, invalid_usage_requests: 0, pending_requests: 0, status: 'unavailable', policy: 'utf8-bytes-plus-overhead-v1' },
  };
}

export function legacyMetrics() {
  return { version: 1, collection: 'not_collected', limits: null, model_calls: null, provider_requests: null, repairs: null, retries: null,
    model_ms: null, provider_ms: null, active_ms: null, approval_wait_ms: null, wall_ms: null, tokens: { status: 'unavailable', reported: { input: null, output: null, total: null }, estimated: null, budget_used: null } };
}

export function validateUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const { prompt_tokens: input, completion_tokens: output, total_tokens: total } = usage;
  if (![input, output, total].every((n) => Number.isSafeInteger(n) && n >= 0) || !Number.isSafeInteger(input + output) || input + output !== total) return null;
  return { input, output, total };
}

// Conservative, dependency-free heuristic; provider tokenization can differ.
export const estimateInput = (messages) => Buffer.byteLength(JSON.stringify(messages), 'utf8') + 128 + 32 * messages.length;

export function planRequest(m, messages, maxOutputTokens = 800) {
  if (m.collection !== 'collected') throw new BudgetError('metrics_unavailable', 'This legacy run has no collected budget. Start a new run.');
  if (!m.is_mock && m.provider_requests >= m.limits.provider_requests) throw new BudgetError('request_budget', `Provider request budget exhausted (${m.provider_requests}/${m.limits.provider_requests}).`);
  const input = estimateInput(messages);
  const remaining = m.limits.token_budget - m.tokens.budget_used;
  const output = Math.min(maxOutputTokens, Math.floor(remaining - input));
  if (output < 64) throw new BudgetError('token_budget', 'Estimated token budget cannot reserve the input and at least 64 output tokens. Start a new run with a larger budget or a smaller context.');
  return { input, output, total: input + output };
}

function tokenStatus(m) {
  const t = m.tokens;
  t.budget_used = (t.reported.total ?? 0) + t.estimated.total;
  t.status = t.reported_requests ? (t.estimated.total ? 'mixed' : 'provider reported') : t.estimated.total ? 'estimated' : 'unavailable';
}

export function startRequest(m, plan, retry) {
  if (!m.is_mock) { m.provider_requests++; if (retry) m.retries++; }
  for (const key of ['input', 'output', 'total']) m.tokens.estimated[key] += plan[key];
  m.tokens.pending_requests++;
  tokenStatus(m);
}

export function settleRequest(m, plan, rawUsage, durationMs) {
  const t = m.tokens;
  const usage = m.is_mock ? null : validateUsage(rawUsage);
  const safeAggregate = usage && ['input', 'output', 'total'].every((k) => Number.isSafeInteger((t.reported[k] ?? 0) + usage[k]));
  if (safeAggregate) {
    for (const key of ['input', 'output', 'total']) { t.estimated[key] -= plan[key]; t.reported[key] = (t.reported[key] ?? 0) + usage[key]; }
    t.reported_requests++;
  } else {
    t.unavailable_requests++;
    if (!m.is_mock && rawUsage != null) t.invalid_usage_requests++;
  }
  t.pending_requests--;
  if (!m.is_mock) m.provider_ms += durationMs;
  tokenStatus(m);
}

export function closeApprovalWait(m) {
  if (m.approval_wait_started_at != null) {
    m.approval_wait_ms += Math.max(0, Date.now() - m.approval_wait_started_at);
    m.approval_wait_started_at = null;
  }
}
