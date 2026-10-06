// Schema validation, tool allow-list, decision parsing and state transitions:
// the deterministic rules the backend enforces regardless of what the model says.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/tools/schema.js';
import { createToolRegistry } from '../src/tools/registry.js';
import { parseDecision, checkGrounding } from '../src/agent/decision.js';
import { createRun, transition, argsHash, canonicalJson } from '../src/agent/state.js';
import { tokenize, createRetrieverFromDocs } from '../src/retrieval/keywordSearch.js';
import { LIMITS } from './helpers.js';

const retriever = createRetrieverFromDocs([{ sourceId: 'http-status', title: 'HTTP', passages: ['401 means unauthenticated.'] }]);
const ctx = (retrieved = []) => ({ retriever, run: { run_id: 'run_x', goal: 'Tóm tắt và lưu bản nháp', retrieved_source_ids: retrieved } });

test('schema: accepts valid input and reports every violation', () => {
  const schema = { type: 'object', properties: { q: { type: 'string', minLength: 2, maxLength: 5 }, n: { type: 'integer', minimum: 1, maximum: 3 } }, required: ['q'], additionalProperties: false };
  assert.deepEqual(validate(schema, { q: 'abc', n: 2 }), []);
  const errors = validate(schema, { q: 'x', n: 9, extra: true });
  assert.equal(errors.length, 3);
  assert.match(errors.join(' '), /shorter than 2/);
  assert.match(errors.join(' '), /above maximum 3/);
  assert.match(errors.join(' '), /not an allowed field/);
  assert.deepEqual(validate(schema, {}), ['$.q: is required']);
  assert.deepEqual(validate(schema, 'text'), ['$: expected object, got string']);
});

test('registry: unknown tool is blocked by the allow-list', () => {
  const res = createToolRegistry().check('delete_all_notes', {}, ctx());
  assert.equal(res.ok, false);
  assert.equal(res.code, 'tool_not_allowed');
});

test('registry: invalid arguments are rejected before execution', () => {
  const reg = createToolRegistry();
  assert.equal(reg.check('search_notes', { query: '' }, ctx()).code, 'invalid_arguments');
  assert.equal(reg.check('search_notes', { query: 'ok query', limit: 50 }, ctx()).code, 'invalid_arguments');
  assert.equal(reg.check('search_notes', { query: 'ok', drop: 'table' }, ctx()).code, 'invalid_arguments');
  assert.equal(reg.check('search_notes', ['not', 'object'], ctx()).code, 'invalid_arguments');
  assert.equal(reg.check('search_notes', { query: 'x'.repeat(7000) }, ctx()).code, 'invalid_arguments');
  assert.equal(reg.check('search_notes', { query: '401 403' }, ctx()).ok, true);
});

test('registry: read and write tools are separated; save_draft may only cite retrieved sources', () => {
  const reg = createToolRegistry();
  assert.equal(reg.get('search_notes').access, 'read');
  assert.equal(reg.get('search_notes').requiresApproval, false);
  assert.equal(reg.get('save_draft').access, 'write');
  assert.equal(reg.get('save_draft').requiresApproval, true);
  const args = { title: 'Tóm tắt', content: 'x', source_ids: ['http-status'] };
  assert.equal(reg.check('save_draft', args, ctx([])).code, 'rule_violation');            // exists but not retrieved
  assert.equal(reg.check('save_draft', { ...args, source_ids: ['nope'] }, ctx(['nope'])).code, 'rule_violation'); // does not exist
  assert.equal(reg.check('save_draft', args, ctx(['http-status'])).ok, true);
});

test('decision: parses the two decision shapes and rejects everything else', () => {
  const opts = { maxAnswerChars: LIMITS.maxAnswerChars, maxModelReplyChars: LIMITS.maxModelReplyChars };
  assert.equal(parseDecision('{"type":"tool_call","tool":"search_notes","arguments":{"query":"a b"}}', opts).ok, true);
  assert.equal(parseDecision('```json\n{"type":"final","answer":"x","source_ids":["a"]}\n```', opts).ok, true);
  assert.deepEqual(parseDecision('Sure! Here is the answer.', opts).errors, ['reply is not valid JSON']);
  assert.equal(parseDecision('[1,2]', opts).ok, false);
  assert.equal(parseDecision('{"type":"think","text":"..."}', opts).ok, false);
  assert.equal(parseDecision('{"type":"tool_call","tool":"x"}', opts).ok, false);            // missing arguments
  assert.match(parseDecision('{"type":"final","answer":"x","source_ids":[]}', opts).errors[0], /unresolved/);
  assert.equal(parseDecision(JSON.stringify({ type: 'final', answer: 'a'.repeat(2001), source_ids: ['a'] }), opts).ok, false);
  assert.equal(parseDecision('x'.repeat(9000), opts).ok, false);
});

test('decision: a final answer may only cite sources retrieved in this run', () => {
  assert.deepEqual(checkGrounding({ source_ids: ['a'] }, ['a', 'b']), []);
  assert.match(checkGrounding({ source_ids: ['a', 'z'] }, ['a'])[0], /z/);
});

test('state: only legal transitions are allowed', () => {
  const run = createRun({ goal: 'g', model: { provider: 'mock', name: 'm', isMock: true } });
  assert.equal(run.status, 'running');
  transition(run, 'awaiting_approval');
  transition(run, 'running');
  transition(run, 'completed');
  assert.throws(() => transition(run, 'running'), /Illegal status transition completed -> running/);
  const r2 = createRun({ goal: 'g', model: { provider: 'mock', name: 'm', isMock: true } });
  assert.throws(() => transition(r2, 'running'), /Illegal/);
});

test('state: approval hash binds run, tool and exact arguments (key order does not matter)', () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
  const h = argsHash('run_1', 'save_draft', { title: 't', content: 'c' });
  assert.equal(h, argsHash('run_1', 'save_draft', { content: 'c', title: 't' }));
  assert.notEqual(h, argsHash('run_1', 'save_draft', { title: 't', content: 'changed' }));
  assert.notEqual(h, argsHash('run_2', 'save_draft', { title: 't', content: 'c' }));
});

test('retrieval: keyword tokenizer ignores accents and case', () => {
  assert.deepEqual(tokenize('Bảo MẬT và Đăng nhập'), ['bao', 'mat', 'dang', 'nhap']);
  assert.ok(tokenize('Phòng thi giữa kỳ').includes('thi'), '"thi" (exam) must stay searchable');
});
