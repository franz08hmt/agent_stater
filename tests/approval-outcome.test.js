import test from 'node:test';
import assert from 'node:assert/strict';
import { latestWriteOutcome } from '../public/approval-outcome.js';

test('write outcome is absent until a save_draft approval is decided', () => {
  assert.equal(latestWriteOutcome([]), null);
  assert.equal(latestWriteOutcome([{ tool: 'save_draft', state: 'pending' }]), null);
});

test('write outcome reports backend approval state, not model prose', () => {
  assert.deepEqual(latestWriteOutcome([{ tool: 'save_draft', state: 'rejected' }]), {
    message: 'Draft not saved — approval rejected.',
    status: 'not-saved',
  });
  assert.deepEqual(latestWriteOutcome([{ tool: 'save_draft', state: 'executed' }]), {
    message: 'Draft saved.',
    status: 'saved',
  });
  assert.deepEqual(latestWriteOutcome([{ tool: 'save_draft', state: 'failed' }]), {
    message: 'Draft not saved — write failed.',
    status: 'not-saved',
  });
  assert.deepEqual(latestWriteOutcome([{ tool: 'save_draft', state: 'cancelled' }]), {
    message: 'Draft not saved — run stopped.',
    status: 'not-saved',
  });
});

test('write outcome uses the latest decided save_draft approval', () => {
  assert.deepEqual(latestWriteOutcome([
    { tool: 'save_draft', state: 'executed' },
    { tool: 'other_tool', state: 'rejected' },
    { tool: 'save_draft', state: 'rejected' },
  ]), {
    message: 'Draft not saved — approval rejected.',
    status: 'not-saved',
  });
});
