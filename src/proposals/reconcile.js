// Restore an interrupted proposal write without executing a tool or model.
export async function reconcileProposal(run, approval, store) {
  try {
    const proposal = await store.getProposal(approval.approval_id);
    if (proposal && proposal.run_id === run.run_id && proposal.args_hash === approval.args_hash) {
      approval.state = 'executed'; approval.write_outcome = 'confirmed';
      approval.result = { proposal_id: proposal.proposal_id, created: false, applied: false };
    } else { approval.state = 'failed'; approval.write_outcome = proposal ? 'unknown' : 'not_saved'; }
  } catch { approval.state = 'failed'; approval.write_outcome = 'unknown'; }
}
