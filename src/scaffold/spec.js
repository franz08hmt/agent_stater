import { validate } from '../tools/schema.js';
import { BUILTIN_TOOLS } from '../tools/registry.js';
import { taskConfigSchema } from '../../config/task.config.js';
import { proposalRequested } from '../proposals/policies.js';

export const SPEC_MAX_BYTES = 64 * 1024;
export const OFFLINE_CONFIG = Object.freeze({ model: { provider: 'mock', name: 'scripted-mock', maxOutputTokens: 800, timeoutMs: 2000, apiKey: '' },
  limits: { maxProviderRequests: 12, tokenBudget: 100000, maxSteps: 6, maxRepairs: 2, toolTimeoutMs: 5000, runMaxMs: 120000,
    maxGoalChars: 500, maxObservationChars: 1800, maxContextChars: 14000, maxAnswerChars: 2000, maxModelReplyChars: 8000 } });
const str = (max = 500) => ({ type: 'string', minLength: 1, maxLength: max });
const strings = { type: 'array', maxItems: 10, uniqueItems: true, items: str() };
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const reference = object({ role: { type: 'string', enum: ['subject', 'target'] }, dataset_id: str(40), record_id: str() });
const count = { type: 'integer', minimum: 0, maximum: 200 };
const readExpected = object({ matched_count: count, compared_count: count, result_count: count, record_ids: strings, sources: strings, contains: str(1000),
  value: str(40), values: { ...strings, minItems: 2, maxItems: 2, uniqueItems: false }, relation: { type: 'string', enum: ['lt', 'eq', 'gt'] } }, []);
const common = { id: { ...str(40), pattern: '^[a-z][a-z0-9-]*$' }, kind: { type: 'string', enum: ['read', 'empty', 'blocked', 'proposal', 'draft'] }, goal: str(),
  tool: { type: 'string', enum: Object.keys(BUILTIN_TOOLS) }, args: { type: 'object' }, expected: { type: 'object' }, answer: str(2000), unresolved: str(500),
  action: str(40), references: { type: 'array', minItems: 1, maxItems: 2, items: reference }, changes: { type: 'object' },
  decision: { type: 'string', enum: ['approve', 'reject'] }, draft: object({ title: str(120), content: str(4000) }) };
export const casesSchema = { type: 'array', minItems: 3, maxItems: 10, items: object(common, ['id', 'kind', 'goal', 'expected']) };
export const manifestSchema = object({ version: { type: 'integer', enum: [1] }, task_id: { ...str(40), pattern: '^[a-z][a-z0-9-]*$' }, cases: casesSchema });
export const specSchema = object({ version: { type: 'integer', enum: [1] }, template: { type: 'string', enum: ['notes', 'dataset-read', 'proposal'] },
  task: taskConfigSchema, assets: { type: 'array', maxItems: 8, items: object({ file: str(160), content: str(32000) }) }, cases: casesSchema });
export function assertSchema(schema, value) { const errors = validate(schema, value); if (errors.length) throw new Error(errors.join('; ')); }
export function noPlaceholders(value) {
  if (typeof value === 'string' && /\b(?:TODO|TBD|CHANGEME|YOUR_TASK)\b|<FILL[^>]*>/i.test(value)) throw new Error('Unconfigured placeholder found; fill mission/data/expected before scaffolding.');
  if (value && typeof value === 'object') for (const child of Object.values(value)) noPlaceholders(child);
}
export function validateCases(cases, task, registry, retriever) {
  assertSchema(casesSchema, cases); noPlaceholders(cases);
  if (new Set(cases.map((c) => c.id)).size !== cases.length) throw new Error('Duplicate acceptance case ID.');
  const ctx = { run: { goal: '', retrieved_source_ids: [], record_evidence: [] }, retriever };
  for (const c of cases) {
    const fields = ['id', 'kind', 'goal', 'expected']; ctx.run.goal = c.goal;
    if (['read', 'empty'].includes(c.kind)) {
      assertSchema(object(Object.fromEntries([...fields, 'tool', 'args', 'answer', 'unresolved'].map((k) => [k, common[k]])), [...fields, 'tool', 'args', 'answer']), c);
      assertSchema(readExpected, c.expected);
      const check = registry.check(c.tool, c.args, ctx);
      if (!check.ok || check.tool.access !== 'read') throw new Error('Read acceptance requires an allowed read tool with valid schema/rules.');
      const e = c.expected;
      if (c.tool === 'search_notes') {
        if (Object.keys(e).some((key) => !['sources', 'result_count', 'contains'].includes(key))) throw new Error('Unsupported notes expected field.');
        if (!Array.isArray(e.sources) || !Number.isInteger(e.result_count) || (c.kind === 'read' && !e.contains) || (c.kind === 'empty' && (!c.unresolved || e.sources.length))) throw new Error('Notes cases require expected sources/count/text; missing evidence needs unresolved.');
      } else {
        const op = c.tool === 'compare_counts' ? 'compare' : c.args.operation;
        const keys = ['matched_count', ...(op === 'lookup' ? ['record_ids'] : op === 'compare' ? ['values', 'relation', 'compared_count'] : ['value'])];
        if (Object.keys(e).some((key) => !keys.includes(key))) throw new Error('Unsupported dataset expected field for this operation.');
        if ([...(e.values || []), ...(e.value === undefined ? [] : [e.value])].some((v) => !/^-?\d+(?:\.\d+)?$/.test(v))) throw new Error('Expected numerical results must be plain decimal strings.');
        if (!Number.isInteger(e.matched_count) || (op === 'lookup' ? !Array.isArray(e.record_ids) : op === 'compare' ? !e.values || !e.relation || !Number.isInteger(e.compared_count) : e.value === undefined)) throw new Error('Dataset expected count and operation result are required.');
        if (c.kind === 'empty' && e.record_ids?.length) throw new Error('Empty lookup must expect no records.');
      }
      if (c.kind === 'empty' && (e.matched_count ?? e.result_count) !== 0) throw new Error('Empty case must expect zero matches.');
      if (c.kind === 'read' && (e.matched_count ?? e.result_count) < 1) throw new Error('Happy read must expect evidence.');
    } else if (c.kind === 'blocked') {
      assertSchema(object(Object.fromEntries([...fields, 'tool', 'args'].map((k) => [k, common[k]]))), c);
      assertSchema(object({ code: { type: 'string', enum: ['tool_not_allowed', 'invalid_arguments', 'rule_violation'] }, error_contains: str(200) }, ['code']), c.expected);
      const check = registry.check(c.tool, c.args, ctx);
      if (check.ok || check.code !== c.expected.code || (c.expected.error_contains && !check.errors.join('; ').includes(c.expected.error_contains))) throw new Error('Blocked case does not exercise its declared rejection.');
    } else if (c.kind === 'proposal') {
      assertSchema(object(Object.fromEntries([...fields, 'action', 'references', 'changes', 'decision'].map((k) => [k, common[k]]))), c);
      assertSchema(object({ proposals: { type: 'integer', minimum: 0, maximum: 1 }, outcome: { type: 'string', enum: ['saved', 'not_saved', 'blocked'] }, error_contains: str(200) }, ['proposals', 'outcome']), c.expected);
      const policy = task.proposalPolicies.find((p) => p.action === c.action);
      if (!registry.get('create_proposal') || !policy || !proposalRequested(c.goal)) throw new Error('Proposal case requires an enabled policy and explicit proposal goal.');
      assertSchema(policy.changes, c.changes);
      const roles = c.references.map((r) => r.role).sort();
      if (roles.join() !== Object.keys(policy.datasets).sort().join() || c.references.some((r) => policy.datasets[r.role]?.id !== r.dataset_id)) throw new Error('Proposal reference roles must match the policy dataset mapping.');
      const blocked = c.expected.outcome === 'blocked', approved = c.decision === 'approve';
      if (c.expected.proposals !== (approved && !blocked ? 1 : 0) || (!blocked && c.expected.outcome !== (approved ? 'saved' : 'not_saved')) || (blocked && !c.expected.error_contains)) throw new Error('Proposal expected outcome/count/rule must be declared consistently.');
    } else {
      assertSchema(object(Object.fromEntries([...fields, 'args', 'draft', 'decision'].map((k) => [k, common[k]]))), c);
      assertSchema(object({ drafts: { type: 'integer', minimum: 0, maximum: 1 }, sources: { ...strings, minItems: 1 } }), c.expected);
      if (!registry.get('save_draft') || c.expected.drafts !== (c.decision === 'approve' ? 1 : 0)) throw new Error('Draft acceptance requires explicit approval expectations and save_draft permission.');
      assertSchema(BUILTIN_TOOLS.search_notes.schema, c.args);
      assertSchema(BUILTIN_TOOLS.save_draft.schema, { ...c.draft, source_ids: c.expected.sources });
      const errors = BUILTIN_TOOLS.save_draft.checkRules({ ...c.draft, source_ids: c.expected.sources }, { retriever, run: { goal: c.goal, retrieved_source_ids: c.expected.sources } });
      if (errors.length) throw new Error(`Draft acceptance invalid: ${errors.join('; ')}`);
    }
  }
  if (!cases.some((c) => c.kind === 'empty') || !cases.some((c) => c.kind === 'blocked' || c.expected.outcome === 'blocked')) throw new Error('Acceptance needs empty/missing and blocked cases.');
  if (registry.get('create_proposal')) {
    if (!cases.some((c) => c.kind === 'proposal' && c.expected.outcome === 'saved') || !cases.some((c) => c.kind === 'proposal' && c.decision === 'reject' && c.expected.outcome === 'not_saved')) throw new Error('Proposal acceptance needs approve and reject with replay.');
  } else if (!cases.some((c) => c.kind === 'read')) throw new Error('Acceptance needs a happy read.');
  if (registry.get('save_draft') && !['approve', 'reject'].every((decision) => cases.some((c) => c.kind === 'draft' && c.decision === decision))) throw new Error('Enabled save_draft needs approve/reject acceptance.');
}
