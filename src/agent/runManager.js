// One history load, partitioned into validated runtimes. Each runner only restores
// its own runs; selecting another task/profile never rewrites a shared "current" runtime.
import { createAgentRunner, AgentError } from './runner.js';
import { STATUS, publicView, transition, argsHash } from './state.js';
import { closeApprovalWait, legacyMetrics } from './metrics.js';

export function createRunManager({ catalog, store, limits, modelTimeoutMs }) {
  const owners = new Map(), runtimes = new Map(), historical = new Map();
  function resolve(taskId = catalog.defaultTaskId, profileId = catalog.defaultProfileId) {
    const task = catalog.tasks.get(taskId), profile = catalog.profiles.get(profileId);
    if (!task || !profile) throw new AgentError('invalid_configuration', 'Select a registered task and model profile.');
    if (!profile.model || profile.metadata.status !== 'configured') throw new AgentError('profile_unavailable', profile.metadata.reason || 'Model profile unavailable.', 409);
    return { task, profile };
  }
  function runtime(taskId, profileId, settings = { limits: structuredClone(limits), modelTimeoutMs }) {
    const { task, profile } = resolve(taskId, profileId);
    const key = JSON.stringify([taskId, profileId, settings]);
    if (!runtimes.has(key)) runtimes.set(key, createAgentRunner({ model: profile.model, registry: task.registry, retriever: task.retriever,
      store, limits: settings.limits, modelTimeoutMs: settings.modelTimeoutMs, task: task.task,
      selection: { task: task.metadata, profile: profile.metadata, identity: profile.identity, settings } }));
    return runtimes.get(key);
  }
  const requireRun = (id) => {
    if (!owners.has(id) && !historical.has(id)) throw new AgentError('run_not_found', 'No run with this ID.', 404);
    return owners.get(id);
  };
  return {
    model: catalog.profiles.get(catalog.defaultProfileId)?.model,
    async init() {
      const batches = new Map();
      for (const run of await store.loadRuns()) {
        const active = [STATUS.RUNNING, STATUS.AWAITING_APPROVAL].includes(run.status);
        if (!active) { run.metrics ??= legacyMetrics(); historical.set(run.run_id, run); continue; }
        const taskId = run.task_id ?? catalog.defaultTaskId, profileId = run.model_profile_id ?? catalog.defaultProfileId;
        const entry = catalog.tasks.get(taskId), profile = catalog.profiles.get(profileId);
        if (!entry || !profile || !profile.model) {
          run.metrics ??= legacyMetrics(); closeApprovalWait(run.metrics);
          if (run.metrics.collection === 'collected') {
            if (run.status === STATUS.RUNNING) {
              run.active_ms = Math.max(run.active_ms || 0, run.metrics.active_ms);
              run.metrics.timing_incomplete = true;
              run.metrics.tokens.unavailable_requests += run.metrics.tokens.pending_requests;
              run.metrics.tokens.pending_requests = 0; // retain unresolved token reservations
            }
            if (run.metrics.model_started_at != null) { run.metrics.model_started_at = null; run.metrics.timing_incomplete = true; }
            run.metrics.wall_ms = Math.max(0, Date.now() - Date.parse(run.created_at));
          }
          const a = run.approvals.find((x) => x.approval_id === run.pending_approval);
          if (a) a.state = 'cancelled'; run.pending_approval = null;
          run.failure = { code: 'configuration_missing', message: 'This run task/model profile is missing or unavailable. Start a new run.' };
          transition(run, STATUS.FAILED);
          const record = { step: run.steps_used, at: run.updated_at, kind: 'system', status: STATUS.FAILED, summary: `${run.failure.code}: ${run.failure.message}` };
          run.trace.push(record); await store.appendAudit({ run_id: run.run_id, ...record });
          await store.saveRun(run); historical.set(run.run_id, run); continue;
        }
        const runner = runtime(taskId, profileId, run.runtime_settings ?? { limits: structuredClone(limits), modelTimeoutMs });
        const batch = batches.get(runner) ?? []; batch.push(run); batches.set(runner, batch); owners.set(run.run_id, runner);
      }
      for (const [runner, runs] of batches) await runner.init(runs);
    },
    async startRun(goal, { task_id = catalog.defaultTaskId, model_profile_id = catalog.defaultProfileId } = {}) {
      const runner = runtime(task_id, model_profile_id);
      const run = await runner.startRun(goal); owners.set(run.run_id, runner); return run;
    },
    getRun(id) { const runner = requireRun(id); return runner ? runner.getRun(id) : publicView(historical.get(id)); },
    listRuns() { return [...owners.keys(), ...historical.keys()].map((id) => this.getRun(id)).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 50); },
    idle(id) { return requireRun(id)?.idle(id) ?? Promise.resolve(); },
    stopRun(id) { const runner = requireRun(id); return runner ? runner.stopRun(id) : Promise.resolve(this.getRun(id)); },
    async decideApproval(id, approvalId, body = {}) {
      const runner = requireRun(id);
      if (!runner) {
        const run = historical.get(id), a = run.approvals.find((x) => x.approval_id === approvalId);
        if (!['approve', 'reject'].includes(body.decision)) throw new AgentError('invalid_decision', 'decision must be approve or reject.');
        if (!a) throw new AgentError('approval_not_found', 'No such approval.', 404);
        if (body.args_hash !== a.args_hash) throw new AgentError('approval_mismatch', 'Approval hash mismatch.', 409);
        if (argsHash(id, a.tool, a.arguments) !== a.args_hash) throw new AgentError('approval_tampered', 'Stored approval hash mismatch.', 409);
        const same = body.decision === 'approve' ? ['executed', 'failed'].includes(a.state) : a.state === 'rejected';
        if (!same) throw new AgentError('approval_already_decided', 'This historical run cannot execute an approval.', 409);
        return { run: publicView(run), replayed: true };
      }
      return runner.decideApproval(id, approvalId, body);
    },
  };
}
