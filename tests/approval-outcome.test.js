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

test('proposal UI outcome requires a confirmed store result and preserves unknown write states', () => {
  const approval = { tool: 'create_proposal', result_kind: 'proposal', state: 'pending' };
  assert.equal(latestWriteOutcome([approval]), null);
  assert.match(latestWriteOutcome([{ ...approval, state: 'executing' }]).message, /unknown/);
  assert.match(latestWriteOutcome([{ ...approval, state: 'failed', write_outcome: 'unknown' }]).message, /unknown/);
  assert.match(latestWriteOutcome([{ ...approval, state: 'executed' }]).message, /unknown/);
  assert.match(latestWriteOutcome([{ ...approval, state: 'rejected' }]).message, /not saved/);
  assert.match(latestWriteOutcome([{ ...approval, state: 'executed', result: { proposal_id: 'apr_one' } }]).message, /saved.*not applied/i);
});
