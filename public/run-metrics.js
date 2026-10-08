const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
const count = (n) => n.toLocaleString('en-US');

export function formatRunMetrics(m) {
  if (!m || m.collection !== 'collected') return { requests: 'Unavailable', tokens: 'Unavailable — not collected', breakdown: 'Unavailable — not collected', calls: 'Unavailable', timing: 'Unavailable', note: 'This saved run predates metrics collection.' };
  const t = m.tokens;
  const parts = [];
  if (t.reported.total !== null) parts.push(`${count(t.reported.total)} provider reported`);
  if (t.estimated.total) parts.push(`${count(t.estimated.total)} estimated / reserved`);
  const tokens = `${parts.join(' + ') || 'Unavailable'}${t.status === 'mixed' ? ' · mixed' : ''}; budget ${count(t.budget_used)} / ${count(m.limits.token_budget)}`;
  return {
    requests: `${m.provider_requests} / ${m.limits.provider_requests}${m.is_mock ? ' · Mock, no HTTP' : ''}`,
    tokens,
    breakdown: `Provider reported input ${t.reported.input == null ? 'unavailable' : count(t.reported.input)} / output ${t.reported.output == null ? 'unavailable' : count(t.reported.output)}; estimated / reserved ${count(t.estimated.total)}`,
    calls: `${m.model_calls} calls · ${m.repairs} repairs · ${m.retries} retries`,
    timing: `Model ${seconds(m.model_ms)} · waiting ${seconds(m.approval_wait_ms)} · total ${seconds(m.wall_ms)}`,
    note: `${m.is_mock ? 'Mock token reservations are simulated. ' : ''}Token budget uses estimates when usage is missing; billed tokens may differ.${m.timing_incomplete ? ' Timing was interrupted by restart.' : ''}`,
  };
}
