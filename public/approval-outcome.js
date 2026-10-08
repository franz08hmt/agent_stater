const OUTCOMES = {
  executed: { message: 'Draft saved.', status: 'saved' },
  rejected: { message: 'Draft not saved — approval rejected.', status: 'not-saved' },
  failed: { message: 'Draft not saved — write failed.', status: 'not-saved' },
  cancelled: { message: 'Draft not saved — run stopped.', status: 'not-saved' },
};

export function latestWriteOutcome(approvals) {
  for (let i = approvals.length - 1; i >= 0; i -= 1) {
    const approval = approvals[i];
    if (approval.result_kind === 'proposal') {
      if (approval.state === 'pending') continue;
      if (approval.state === 'executed' && approval.result?.proposal_id) return { message: 'Proposal saved. Changes not applied.', status: 'saved' };
      if (approval.state === 'executing' || approval.state === 'executed' || approval.write_outcome === 'unknown') return { message: 'Proposal outcome unknown. Check saved proposals or reconcile after restart.', status: 'unknown' };
      return { message: 'Proposal not saved.', status: 'not-saved' };
    }
    if (approval.tool === 'save_draft' && OUTCOMES[approval.state]) return OUTCOMES[approval.state];
  }
  return null;
}
