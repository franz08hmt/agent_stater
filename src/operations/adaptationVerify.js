// Finite verification campaign; the shared gate covers every adapter HTTP/retry.
import { BudgetError } from '../agent/metrics.js';
export function adaptationSession(limit = 48) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 48) throw new Error('Adaptation campaign cap must be 1..48 HTTP.');
  const session = { used: 0, limit };
  return { session, wrap(model) {
    return { ...model, complete(args) {
      const control = args.requestControl;
      if (!control) throw new Error('Accounting is required for campaign inference.');
      return model.complete({ ...args, requestControl: { ...control,
        beforeRequest(messages, cap) {
          if (session.used >= session.limit) throw new BudgetError('session_request_budget', 'Adaptation campaign HTTP cap exhausted.');
          return control.beforeRequest(messages, cap);
        },
        requestStarted(plan, retry) { session.used++; return control.requestStarted(plan, retry); },
      } });
    } };
  } };
}
