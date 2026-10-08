import { validate } from './schema.js';
import { bindPolicies, proposalRequested } from '../proposals/policies.js';
import { argsHash } from '../agent/state.js';
import { proposalConfirmations } from '../agent/writeLanguage.js';

const id = { type: 'string', minLength: 1, maxLength: 500 };
export function createProposalTool(datasets = [], task = {}) {
  const policies = task.proposalPolicies ?? bindPolicies([], datasets);
  const schemas = policies.map((p) => p.changes);
  const schema = { type: 'object', additionalProperties: false, required: ['action', 'references', 'changes', 'reason'], properties: {
    action: { type: 'string', enum: policies.map((p) => p.action) },
    references: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'object', additionalProperties: false,
      required: ['role', 'dataset_id', 'record_id', 'source_id'], properties: {
        role: { type: 'string', enum: ['subject', 'target'] }, dataset_id: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,39}$' },
        record_id: id, source_id: { type: 'string', pattern: '^[a-z0-9-]{1,60}$' },
      } } },
    changes: schemas.length === 1 ? schemas[0] : { type: 'object', additionalProperties: false,
      properties: Object.assign({}, ...schemas.map((s) => s.properties)) },
    reason: { type: 'string', minLength: 3, maxLength: 300 },
  } };
  function resolve(args, ctx) {
    const errors = validate(schema, args);
    if (errors.length) return { errors };
    if (!proposalRequested(ctx.run?.goal)) errors.push('proposal_not_requested: begin an explicit goal with Create a proposal / Tạo đề xuất. Quoted or negated requests do not authorize writing.');
    const policy = policies.find((p) => p.action === args.action);
    errors.push(...validate(policy.changes, args.changes));
    const roles = args.references.map((r) => r.role).sort();
    if (roles.join() !== Object.keys(policy.roles).sort().join()) errors.push('Reference roles must match policy exactly, without duplicates.');
    const records = {}, references = [];
    for (const ref of args.references) {
      const data = policy.datasets[ref.role];
      const evidence = ctx.run?.record_evidence?.find((e) => e.dataset_id === ref.dataset_id && e.source_id === ref.source_id
        && e.dataset_version === data?.version && e.record_ids.includes(ref.record_id));
      const record = data?.id === ref.dataset_id ? data.rows.find((r) => r[data.idColumn] === ref.record_id) : null;
      if (!evidence || !record || !ctx.run?.retrieved_source_ids.includes(ref.source_id)) errors.push('Reference must match a record actually returned by lookup in this run and its snapshot.');
      else { records[ref.role] = record; references.push({ ...ref, dataset_version: data.version }); }
    }
    if (!errors.length) errors.push(...policy.check(records, args.changes, policy.datasets));
    return { errors, references };
  }
  return {
    name: 'create_proposal', access: 'write', requiresApproval: true, resultKind: 'proposal',
    description: 'Save an INTERNAL proposal only after human approval; never apply changes to the original dataset. '
      + 'Only when the goal explicitly requests a proposal. First lookup every referenced record; use exact returned source_id and record ID. Aggregate results do not qualify. '
      + 'Arguments: action, references [{role,dataset_id,record_id,source_id}], changes, reason. After human decision final.answer must be exactly one confirmation matching the outcome and goal language. EN saved: Proposal saved; changes not applied. EN rejected: Proposal not saved. EN unknown: Proposal outcome unknown. VI saved: Đã lưu đề xuất; chưa áp dụng thay đổi. VI rejected: Không lưu đề xuất. VI unknown: Chưa xác định được kết quả lưu đề xuất. '
      + policies.map((p) => `${p.description} Dataset roles: ${JSON.stringify(Object.fromEntries(Object.entries(p.datasets).map(([r, d]) => [r, d.id])))}`).join(' '),
    schema, checkRules: (args, ctx = {}) => resolve(args, ctx).errors,
    checkFinal(decision, run) {
      const approval = run.approvals.findLast((a) => a.result_kind === 'proposal' && a.state !== 'pending');
      if (!approval) return [];
      const expected = proposalConfirmations(run, approval);
      return expected.includes(decision.answer.trim()) ? [] : [`Report the backend write outcome exactly, in the goal language: ${expected.join(' / ')}`];
    },
    async execute(args, ctx) {
      const checked = resolve(args, ctx);
      if (checked.errors.length) throw Object.assign(new Error(checked.errors.join('; ')), { writeOutcome: 'not_saved' });
      if (!ctx.idempotencyKey) throw Object.assign(new Error('Proposal requires an approval idempotency key.'), { writeOutcome: 'not_saved' });
      // Reload the backend-validated task and bounded data files. No model paths.
      if (!task.verifyCurrent || !await task.verifyCurrent()) throw Object.assign(new Error('task_changed: task, policy or dataset changed; create a new run.'), { writeOutcome: 'not_saved' });
      if (ctx.signal?.aborted) throw Object.assign(new Error('Proposal execution cancelled before publication.'), { writeOutcome: 'not_saved' });
      const { proposal, created } = await ctx.store.createProposalOnce(ctx.idempotencyKey, {
        proposal_id: ctx.idempotencyKey, run_id: ctx.run.run_id, task_id: task.id, task_fingerprint: task.fingerprint,
        args_hash: argsHash(ctx.run.run_id, 'create_proposal', args), action: args.action,
        references: checked.references, changes: args.changes, reason: args.reason, applied: false, created_at: new Date().toISOString(),
      }, { signal: ctx.signal });
      return { proposal_id: proposal.proposal_id, created, applied: false };
    },
  };
}
export const createProposal = createProposalTool();
