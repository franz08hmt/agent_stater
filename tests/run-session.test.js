import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRunSession, rememberRun } from '../public/run-session.js';
test('browser session stores only one validated run ID, never the goal or configuration', () => {
  const values = new Map();
  const storage = { getItem: (k) => values.get(k), setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) };
  rememberRun(storage, 'run_test-123'); assert.deepEqual(readRunSession(storage), { id: 'run_test-123', invalid: false });
  assert.equal(values.size, 1);
  rememberRun(storage, 'invalid'); assert.equal(readRunSession(storage).id, 'run_test-123');
  values.set('agent-studio.viewed-run', '../other'); assert.deepEqual(readRunSession(storage), { id: null, invalid: true }); assert.equal(values.size, 0);
  rememberRun(storage, null); assert.equal(readRunSession(storage).id, null);
});
test('disabled browser storage does not break run operations', () => {
  const blocked = { getItem() { throw new Error(); }, setItem() { throw new Error(); }, removeItem() { throw new Error(); } };
  assert.equal(readRunSession(blocked).id, null); assert.doesNotThrow(() => rememberRun(blocked, 'run_test'));
});
