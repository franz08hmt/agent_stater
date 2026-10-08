import { t as tr } from './i18n.js';
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
const count = (n) => n.toLocaleString('en-US');

export function formatRunMetrics(m) {
  if (!m || m.collection !== 'collected') return { requests: tr('Unavailable'), tokens: tr('Unavailable — not collected'), breakdown: tr('Unavailable — not collected'), calls: tr('Unavailable'), timing: tr('Unavailable'), note: tr('This saved run predates metrics collection.') };
  const t = m.tokens;
  const parts = [];
  if (t.reported.total !== null) parts.push(`${count(t.reported.total)} ${tr("provider reported")}`);
  if (t.estimated.total) parts.push(`${count(t.estimated.total)} ${tr("estimated / reserved")}`);
  const tokens = `${parts.join(' + ') || tr('Unavailable')}${t.status === 'mixed' ? ` · ${tr('mixed')}` : ''}; ${tr("budget")} ${count(t.budget_used)} / ${count(m.limits.token_budget)}`;
  return {
    requests: `${m.provider_requests} / ${m.limits.provider_requests}${m.is_mock ? ` · ${tr('Mock, no HTTP')}` : ''}`,
    tokens,
    breakdown: `${tr("Provider reported input")} ${t.reported.input == null ? tr('unavailable') : count(t.reported.input)} / ${tr("output")} ${t.reported.output == null ? tr('unavailable') : count(t.reported.output)}; ${tr("estimated / reserved")} ${count(t.estimated.total)}`,
    calls: `${m.model_calls} ${tr('calls')} · ${m.repairs} ${tr('repairs')} · ${m.retries} ${tr('retries')}`,
    timing: `${tr("Model")} ${seconds(m.model_ms)} · ${tr('waiting')} ${seconds(m.approval_wait_ms)} · ${tr('total')} ${seconds(m.wall_ms)}`,
    note: `${m.is_mock ? tr('Mock token reservations are simulated. ') : ''}${tr("Token budget uses estimates when usage is missing; billed tokens may differ.")}${m.timing_incomplete ? tr(' Timing was interrupted by restart.') : ''}`,
  };
}
