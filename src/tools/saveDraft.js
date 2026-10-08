// WRITE tool. Never runs on the model's say-so: the runner parks the call in
// "awaiting_approval" and only a matching human approval executes it.

import { tokenize } from '../retrieval/keywordSearch.js';
import { CONFIRMATIONS, writeOutcome } from '../agent/writeLanguage.js';

export const saveDraft = {
  name: 'save_draft',
  access: 'write',
  requiresApproval: true,
  description:
    'Save a summary draft to backend-managed storage. Requires human approval; the call pauses until a person approves or rejects it. '
    + 'source_ids must be ids returned by search_notes in this run.',
  schema: {
    type: 'object',
    properties: {
      title: { type: 'string', minLength: 3, maxLength: 120 },
      content: { type: 'string', minLength: 1, maxLength: 4000 },
      source_ids: {
        type: 'array', minItems: 1, maxItems: 5, uniqueItems: true,
        items: { type: 'string', pattern: '^[a-z0-9-]{1,60}$' },
      },
    },
    required: ['title', 'content', 'source_ids'],
    additionalProperties: false,
  },

  // Historical factual summaries remain compatible. Finite status confirmations
  // must never contradict approval/store; broader prose is not a semantic PASS.
  checkFinal(decision, run) {
    const approval = run.approvals.findLast((a) => a.tool === 'save_draft' && a.state !== 'pending');
    if (!approval) return [];
    const answer = decision.answer.trim().replace(/[.!]$/, '').toLowerCase();
    const matched = Object.entries(CONFIRMATIONS.draft).find(([, phrases]) => phrases.some((p) => p.replace(/[.!]$/, '').toLowerCase() === answer));
    return matched && matched[0] !== writeOutcome(approval) ? ['Draft confirmation contradicts the backend approval/store outcome.'] : [];
  },

  /** A draft may only cite notes that exist AND that this run actually retrieved. */
  checkRules(args, ctx) {
    const errors = [];
    const original = (ctx.run?.goal || '').replace(/"[^"]*"|'[^']*'|`[^`]*`|“[^”]*”|‘[^’]*’/g, ' ');
    const goal = tokenize(original);
    const negated = /\b(?:do not|never|without|don't|khong|dung)\s+(?:save|store|create|write|luu|tao|ghi)\b/.test(goal.join(' '))
      || /don't\s+(save|store|write|create)/i.test(original);
    const saveRequested = goal.some((word) => ['luu', 'save', 'store'].includes(word))
      || (goal.includes('ban') && goal.includes('nhap') && goal.some((word) => ['tao', 'viet', 'ghi'].includes(word)))
      || (goal.includes('draft') && goal.some((word) => ['create', 'write'].includes(word)));
    if (!saveRequested || negated) errors.push('save_not_requested: the original unquoted goal did not explicitly request saving a draft.');
    for (const id of args.source_ids) {
      if (!ctx.retriever.has(id)) errors.push(`source_id "${id}" does not exist in the notes.`);
      else if (!ctx.run.retrieved_source_ids.includes(id)) errors.push(`source_id "${id}" was not retrieved in this run; search for it first.`);
    }
    return errors;
  },

  async execute(args, ctx) {
    if (!ctx.idempotencyKey) throw new Error('save_draft requires an idempotency key (the approval id).');
    const { draft, created } = await ctx.store.createDraftOnce(ctx.idempotencyKey, {
      draft_id: ctx.idempotencyKey,
      run_id: ctx.run.run_id,
      title: args.title,
      content: args.content,
      source_ids: args.source_ids,
      created_at: new Date().toISOString(),
    });
    return { draft_id: draft.draft_id, created };
  },
};
