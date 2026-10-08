// Sequential verification accounting, layered over the existing per-suite/per-run gates.
import { warmProfile, localEndpoint } from './localModel.js';
import { probeProfile } from '../model/probe.js';
import { modelCheckStatus } from './reports.js';

export function createCampaignSession(limit = 160) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 160) throw new Error('Campaign cap must be 1..160 HTTP requests.');
  return { limit, used: 0 };
}
export async function campaignCheck(session, profile, kind) {
  localEndpoint(profile);
  if (!['warm','probe'].includes(kind)) throw new Error('Unknown model check.');
  if (session.used >= session.limit) return { status: 'NOT_RUN', kind, reason: 'Global campaign cap exhausted.' };
  // Each existing check has a hard limit of ONE HTTP and retry:false. Checks are sequential.
  const check = kind === 'warm' ? await warmProfile(profile) : await probeProfile(profile);
  session.used += check.metrics.provider_requests;
  return { ...check, kind, status: modelCheckStatus(check) };
}
export async function campaignGroup(session, runner, options) {
  const remaining = session.limit - session.used;
  if (!remaining) return { status:'NOT_RUN', session:{provider_requests:0,limit:0}, results:options.cases.flatMap(c=>Array.from({length:options.repeat},(_,i)=>({id:c.id,trial:i+1,status:'NOT_RUN',reason:'Global campaign cap exhausted.'}))) };
  // A suite gates every request AND retry with this remaining cap; no other group runs concurrently.
  const report = await runner({ ...options, maxRequests: remaining });
  session.used += report.session.provider_requests;
  return report;
}
export function summarizeMetrics(results) {
  const total = { provider_requests:0, model_calls:0, repairs:0, retries:0, model_ms:0,
    reported:{input:null,output:null,total:null}, estimated:{input:0,output:0,total:0}, unavailable_requests:0,invalid_usage_requests:0,pending_requests:0 };
  for (const {metrics:m} of results) {
    if (!m) continue;
    for (const k of ['provider_requests','model_calls','repairs','retries','model_ms']) total[k]+=m[k]??0;
    for (const k of ['input','output','total']) {
      if (m.tokens.reported[k]!=null) total.reported[k]=(total.reported[k]??0)+m.tokens.reported[k];
      total.estimated[k]+=m.tokens.estimated?.[k]??0;
    }
    for (const k of ['unavailable_requests','invalid_usage_requests','pending_requests']) total[k]+=m.tokens[k]??0;
  }
  total.usage_status=total.reported.total==null ? total.estimated.total ? 'estimated' : 'unavailable' : total.estimated.total ? 'mixed' : 'provider reported';
  return total;
}
export function passStreaks(results) {
  const streaks={};
  for(const r of results) streaks[r.id]=r.status==='PASS'?(streaks[r.id]??0)+1:0;
  return streaks;
}
