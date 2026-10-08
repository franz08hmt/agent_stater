// Finite confirmations, independent of UI locale. Legacy proposal runs stay EN.
export const CONFIRMATIONS = Object.freeze({
  proposal: {
    saved: ['Proposal saved; changes not applied.', 'Đã lưu đề xuất; chưa áp dụng thay đổi.'],
    not_saved: ['Proposal not saved.', 'Không lưu đề xuất.'],
    unknown: ['Proposal outcome unknown.', 'Chưa xác định được kết quả lưu đề xuất.'],
  },
  draft: {
    saved: ['Saved.', 'Đã lưu bản nháp.'],
    not_saved: ['Not saved.', 'Không lưu bản nháp.'],
    unknown: ['Draft outcome unknown.', 'Chưa xác định được kết quả lưu bản nháp.'],
  },
});
export function writeOutcome(approval) {
  if (approval.write_outcome === 'unknown') return 'unknown';
  return approval.state === 'executed' && (approval.result?.proposal_id || approval.result?.draft_id) ? 'saved' : 'not_saved';
}
export function proposalConfirmations(run, approval) {
  const phrases = CONFIRMATIONS.proposal[writeOutcome(approval)];
  return run.language_policy === 'goal-natural-v1' ? phrases : phrases.slice(0, 1);
}
