// Turns the model's raw text into a validated decision, or a list of reasons it was
// rejected. The runner never acts on anything that has not passed through here.

import { validate } from '../tools/schema.js';

const TOOL_CALL_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['tool_call'] },
    tool: { type: 'string', minLength: 1, maxLength: 60 },
    arguments: { type: 'object' },
  },
  required: ['type', 'tool', 'arguments'],
  additionalProperties: false,
};

const finalSchema = (maxAnswerChars) => ({
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['final'] },
    answer: { type: 'string', minLength: 1, maxLength: maxAnswerChars },
    source_ids: { type: 'array', maxItems: 10, uniqueItems: true, items: { type: 'string', maxLength: 60 } },
    unresolved: { type: 'string', maxLength: 1000 },
  },
  required: ['type', 'answer', 'source_ids'],
  additionalProperties: false,
});

/** Accept a bare JSON object, optionally wrapped in a ```json fence — nothing looser. */
function extractJson(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

/**
 * @returns {{ ok: true, decision: object } | { ok: false, errors: string[] }}
 */
export function parseDecision(text, { maxAnswerChars, maxModelReplyChars }) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, errors: ['empty reply'] };
  if (text.length > maxModelReplyChars) return { ok: false, errors: [`reply longer than ${maxModelReplyChars} characters`] };

  let value;
  try {
    value = JSON.parse(extractJson(text));
  } catch {
    return { ok: false, errors: ['reply is not valid JSON'] };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: ['reply must be a JSON object'] };
  }

  if (value.type === 'tool_call') {
    const errors = validate(TOOL_CALL_SCHEMA, value);
    return errors.length ? { ok: false, errors } : { ok: true, decision: value };
  }
  if (value.type === 'final') {
    const errors = validate(finalSchema(maxAnswerChars), value);
    if (!errors.length && value.source_ids.length === 0 && !(value.unresolved || '').trim()) {
      errors.push('a final answer without source_ids must explain the gap in "unresolved"');
    }
    return errors.length ? { ok: false, errors } : { ok: true, decision: { unresolved: '', ...value } };
  }
  return { ok: false, errors: ['"type" must be "tool_call" or "final"'] };
}

/** A final answer may only cite sources that search_notes actually returned in this run. */
export function checkGrounding(decision, retrievedIds) {
  const unknown = decision.source_ids.filter((id) => !retrievedIds.includes(id));
  return unknown.length ? [`source_ids not retrieved in this run: ${unknown.join(', ')}`] : [];
}
