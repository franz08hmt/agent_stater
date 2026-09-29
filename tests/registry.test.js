// Tool declaration rules: a write tool can never be registered without requiring approval.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createToolRegistry, assertToolDeclarations } from '../src/tools/registry.js';
import { searchNotes } from '../src/tools/searchNotes.js';
import { saveDraft } from '../src/tools/saveDraft.js';
import { harness, tool as toolCall, final } from './helpers.js';

const schema = { type: 'object', properties: {}, additionalProperties: false };
const declare = (over = {}) => ({
  name: 'send_note', access: 'write', requiresApproval: true, description: 'x', schema,
  checkRules: () => [], execute: async () => ({ ok: true }), ...over,
});

test('the shipped tools satisfy the rule: search_notes reads, save_draft writes and requires approval', () => {
  assert.doesNotThrow(() => createToolRegistry());
  assert.equal(saveDraft.access, 'write');
  assert.equal(saveDraft.requiresApproval, true);
  assert.equal(searchNotes.access, 'read');
});

test('a write tool without requiresApproval is refused when the registry is built', () => {
  assert.throws(() => createToolRegistry([declare({ requiresApproval: false })]), /send_note.*access: 'write' but requiresApproval is not true/);
  assert.throws(() => createToolRegistry([declare({ requiresApproval: undefined })]), /requiresApproval is not true/);
  const noFlag = declare();
  delete noFlag.requiresApproval;
  assert.throws(() => createToolRegistry([noFlag]), /requiresApproval is not true/);
});

test('"truthy" is not enough: requiresApproval must be the boolean true', () => {
  for (const wrong of ['true', 'yes', 1, {}, []]) {
    assert.throws(() => createToolRegistry([declare({ requiresApproval: wrong })]), /requiresApproval is not true/, `accepted ${JSON.stringify(wrong)}`);
  }
});

test('access must be exactly "read" or "write": a missing or misspelled value cannot bypass the rule', () => {
  for (const wrong of [undefined, null, '', 'Write', 'WRITE', 'rw', 'admin', 'delete']) {
    assert.throws(() => createToolRegistry([declare({ access: wrong, requiresApproval: false })]), /must declare access/, `accepted ${JSON.stringify(wrong)}`);
  }
});

test('a correct write tool and a read tool that needs no approval are both accepted', () => {
  const reg = createToolRegistry([declare(), declare({ name: 'look_up', access: 'read', requiresApproval: false })]);
  assert.equal(reg.get('send_note').requiresApproval, true);
  assert.equal(reg.get('look_up').requiresApproval, false);
});

test('duplicate tool names are refused so a later tool cannot silently replace an earlier one', () => {
  assert.throws(() => createToolRegistry([declare(), declare({ access: 'read', requiresApproval: false })]), /Duplicate tool name "send_note"/);
  assert.throws(() => assertToolDeclarations([searchNotes, searchNotes]), /Duplicate/);
});

test('the error names the offending tool, so it is fixable in seconds on exam day', () => {
  try {
    createToolRegistry([searchNotes, declare({ name: 'refund_order', requiresApproval: false })]);
    assert.fail('should have thrown');
  } catch (err) {
    assert.match(err.message, /"refund_order"/);
    assert.doesNotMatch(err.message, /search_notes/);
  }
});

test('defence in depth: even a hand-built registry cannot run a write tool without a human decision', async (t) => {
  // Bypasses createToolRegistry() on purpose, to model a future edit that skips the declaration check.
  let executed = 0;
  const rogue = declare({ name: 'rogue_write', requiresApproval: false, execute: async () => { executed += 1; return { ok: true }; } });
  const handBuilt = {
    describe: () => [{ name: rogue.name, access: rogue.access }],
    get: (name) => (name === rogue.name ? rogue : undefined),
    check: (name) => (name === rogue.name ? { ok: true, tool: rogue } : { ok: false, code: 'tool_not_allowed', errors: ['no'] }),
  };
  const h = await harness({ registry: handBuilt, replies: [toolCall('rogue_write', {}), final('done', [], 'x')] });
  t.after(h.cleanup);
  const run = await h.run('Ghi gì đó');
  assert.equal(run.status, 'awaiting_approval', 'the write is parked, not executed');
  assert.equal(executed, 0, 'the write function never ran');
  assert.equal(run.approvals[0].tool, 'rogue_write');
});
