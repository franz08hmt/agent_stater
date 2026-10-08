// Policies are code-owned. Task JSON only selects a registered policy and IDs.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validate } from '../tools/schema.js';
import { decimalUnits } from '../data/datasets.js';
import { ASSET_QUANTITY_SCHEMA, assetAvailability, assertAssetDataset } from '../business/assetAvailability.js';

export async function policyFingerprint() {
  const digest = createHash('sha256');
  for (const name of ['./policies.js', '../business/assetAvailability.js'].sort()) digest.update(name).update(await readFile(new URL(name, import.meta.url)));
  return digest.digest('hex');
}
export const POLICY_FINGERPRINT = await policyFingerprint();
const string = { type: 'string', minLength: 1, maxLength: 80 };
export const POLICIES = Object.freeze({
  'asset-loan': {
    action: 'asset_loan', roles: { subject: { available: 'number' } },
    changes: { type: 'object', additionalProperties: false, required: ['quantity'], properties: { quantity: ASSET_QUANTITY_SCHEMA } },
    description: 'asset_loan: subject asset; changes {quantity: integer 1..20}. Availability must cover quantity. Internal proposal only; inventory unchanged, no booking or actual loan.',
    check(records, changes) { return assetAvailability(records.subject, changes.quantity).eligible ? [] : ['Asset availability is insufficient for requested quantity.']; },
  },
  'ticket-status': {
    action: 'ticket_status', roles: { subject: { status: 'string' } },
    changes: { type: 'object', additionalProperties: false, required: ['status'], properties: { status: { ...string, enum: ['open', 'pending', 'closed'] } } },
    description: 'ticket_status: subject ticket; changes {status: open|pending|closed}. open -> pending/closed; pending -> open/closed; closed is terminal.',
    check(records, changes) {
      const current = records.subject.status;
      return ({ open: ['pending', 'closed'], pending: ['open', 'closed'], closed: [] }[current] || []).includes(changes.status)
        ? [] : ['Ticket transition is invalid or already at the requested status.'];
    },
  },
  'class-room': {
    action: 'class_room', roles: { subject: { room: 'string', students: 'number' }, target: { room: 'string', capacity: 'number' } },
    changes: { type: 'object', additionalProperties: false, required: ['room'], properties: { room: string } },
    description: 'class_room: subject class and target room; changes {room: exact target room name}. Different room and capacity >= students required. No timetable conflict or real booking check.',
    check(records, changes, datasets) {
      const errors = [];
      if (changes.room !== records.target.room) errors.push('changes.room must match the retrieved target room.');
      if (records.subject.room === records.target.room) errors.push('Target is the current room.');
      const scale = Math.max(datasets.subject.columns.find((c) => c.name === 'students').scale ?? 0,
        datasets.target.columns.find((c) => c.name === 'capacity').scale ?? 0);
      const students = decimalUnits(records.subject.students, scale), capacity = decimalUnits(records.target.capacity, scale);
      if (students < 0n || capacity < 0n || capacity < students) errors.push('Target capacity is insufficient or negative.');
      return errors;
    },
  },
});
export const proposalPoliciesSchema = { type: 'array', maxItems: 2, items: { type: 'object', additionalProperties: false,
  required: ['policy_id', 'datasets'], properties: {
    policy_id: { type: 'string', enum: Object.keys(POLICIES) },
    datasets: { type: 'object', additionalProperties: false, properties: {
      subject: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,39}$' }, target: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,39}$' },
    } },
  } } };
export function bindPolicies(definitions = [], snapshots = []) {
  const errors = validate(proposalPoliciesSchema, definitions);
  if (errors.length) throw new Error(errors.join('; '));
  const seen = new Set();
  return definitions.map((def) => {
    const policy = POLICIES[def.policy_id];
    if (seen.has(def.policy_id)) throw new Error('Duplicate proposal policy.'); seen.add(def.policy_id);
    if (Object.keys(def.datasets).sort().join() !== Object.keys(policy.roles).sort().join()) throw new Error('Policy dataset roles must match exactly.');
    const datasets = {};
    for (const [role, fields] of Object.entries(policy.roles)) {
      const data = snapshots.find((d) => d.id === def.datasets[role]);
      if (!data || Object.entries(fields).some(([name, type]) => !data.columns.some((c) => c.name === name && c.type === type))) {
        throw new Error('Policy field mapping requires declared datasets and correctly typed columns.');
      }
      if (def.policy_id === 'ticket-status' && data.rows.some((r) => !['open', 'pending', 'closed'].includes(r.status))) throw new Error('Ticket dataset has an unknown status.');
      if (def.policy_id === 'class-room' && role === 'target' && new Set(data.rows.map((r) => r.room)).size !== data.rows.length) throw new Error('Target room names must be unique.');
      if (def.policy_id === 'asset-loan') assertAssetDataset(data);
      datasets[role] = data;
    }
    return { ...policy, policyId: def.policy_id, datasets };
  });
}

// Deliberately small intent grammar, documented for exam use. Quoted data is
// removed; only a positive top-level imperative may authorize a proposal.
export function proposalRequested(goal = '') {
  const clean = goal.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/"[^"]*"|'[^']*'|`[^`]*`|“[^”]*”|‘[^’]*’/g, ' ').trim().toLowerCase();
  const positive = /^(?:please\s+)?(?:create|save)\s+(?:an?\s+)?proposal\b|^(?:hay\s+)?(?:tao|luu)\s+(?:mot\s+)?de xuat\b/.test(clean);
  const negative = /\b(?:do not|don't|never|no|not|without|khong|dung)\s+(?:(?:please|ever)\s+)?(?:creat(?:e|ing)|sav(?:e|ing)|stor(?:e|ing)|writ(?:e|ing)|persist|tao|luu|ghi)\b/.test(clean);
  // An imperative-looking prefix is insufficient for a question/definition.
  const ambiguous = /[?？]|\b(?:la gi|duoc hieu la|co nghia la)\b/.test(clean)
    || /^(?:(?:please|hay)\s+)?(?:create|save|tao|luu)\s+(?:(?:a|an|the|mot)\s+)?(?:proposal|de xuat)\s+(?:is|are|means?|la|duoc hieu)\b/.test(clean);
  return positive && !negative && !ambiguous;
}
