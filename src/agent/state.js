// Run state and the only legal status transitions. Every status change goes
// through transition(), so an illegal jump (e.g. completed -> running) throws.

import { randomUUID, createHash } from 'node:crypto';

export const STATUS = Object.freeze({
  RUNNING: 'running',
  AWAITING_APPROVAL: 'awaiting_approval',
  COMPLETED: 'completed',
  FAILED: 'failed',
  STOPPED: 'stopped',
});

const ALLOWED = {
  running: ['awaiting_approval', 'completed', 'failed', 'stopped'],
  awaiting_approval: ['running', 'failed', 'stopped'],
  completed: [],
  failed: [],
  stopped: [],
};

export const isTerminal = (status) => ALLOWED[status]?.length === 0;

export function transition(run, to) {
  if (!ALLOWED[run.status]?.includes(to)) {
    throw new Error(`Illegal status transition ${run.status} -> ${to}`);
  }
  run.status = to;
  run.updated_at = new Date().toISOString();
}

export function createRun({ goal, model }) {
  const now = new Date().toISOString();
  return {
    run_id: `run_${randomUUID()}`,
    goal,
    status: STATUS.RUNNING,
    steps_used: 0,          // tool calls attempted (executed, rejected or approved)
    repairs_used: 0,        // malformed model replies that were retried
    active_ms: 0,           // execution time, excluding time spent waiting for approval
    created_at: now,
    updated_at: now,
    model: { provider: model.provider, name: model.name, is_mock: model.isMock },
    trace: [],              // what the UI shows: actions and observations, no model reasoning
    retrieved_source_ids: [],
    retrieved_passages: [], // "source§paragraph" for every passage a tool returned
    executed_calls: [],     // signatures of calls already made, for repeat detection
    approvals: [],          // every write proposal and what happened to it
    pending_approval: null, // approval_id currently blocking the run
    final: null,            // { answer, source_ids, unresolved }
    failure: null,          // { code, message }
    messages: [],           // conversation sent to the model (internal, not returned by the API)
  };
}

/** Stable JSON: object keys sorted, so the same arguments always hash the same way. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Binds an approval to one run, one tool and one exact argument set. */
export function argsHash(runId, tool, args) {
  return createHash('sha256').update(canonicalJson({ run_id: runId, tool, arguments: args })).digest('hex');
}

export const callSignature = (tool, args) => `${tool}:${canonicalJson(args)}`;

/** What the API returns: everything except the raw model conversation. */
export function publicView(run) {
  const { messages, ...rest } = run;
  return structuredClone(rest);
}
