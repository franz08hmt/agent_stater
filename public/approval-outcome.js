const OUTCOMES = {
  executed: { message: 'Draft saved.', status: 'saved' },
  rejected: { message: 'Draft not saved — approval rejected.', status: 'not-saved' },
  failed: { message: 'Draft not saved — write failed.', status: 'not-saved' },
  cancelled: { message: 'Draft not saved — run stopped.', status: 'not-saved' },
};

export function latestWriteOutcome(approvals) {
  for (let i = approvals.length - 1; i >= 0; i -= 1) {
    const approval = approvals[i];
    if (approval.tool === 'save_draft' && OUTCOMES[approval.state]) return OUTCOMES[approval.state];
  }
  return null;
}
