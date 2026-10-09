// Pure helpers for the "Questions and answers" board: which runs to show and how one card reads.
// No DOM and no network here, so the rules are testable in Node.

/**
 * @param runs   runs as returned by GET /api/runs
 * @param options.task   task id to show (all tasks when empty)
 * @param options.last   show at most this many runs (the newest ones), in the order they were asked
 * @param options.since  ISO time; only runs created AFTER it are shown ("start fresh")
 */
export function selectRuns(runs, { task = '', last = 5, since = null } = {}) {
  const count = Number.isInteger(last) && last >= 1 ? Math.min(last, 12) : 5;
  return runs
    .filter((run) => (!task || run.task_id === task) && (!since || run.created_at > since))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(-count);
}

/** One card: only what a reader needs (question, answer, sources). Never shows an answer for a run that has none. */
export function cardModel(run, number) {
  const done = run.status === 'completed' && Boolean(run.final);
  const labels = run.source_labels ?? {};
  return {
    id: run.run_id,
    number,
    status: run.status,
    question: String(run.goal ?? '').trim(),
    answer: done ? run.final.answer : '',
    sources: done ? run.final.source_ids.map((id) => (labels[id] ? `${labels[id]} — ${id}` : id)) : [],
    gap: done ? run.final.unresolved || '' : '',
    failure: run.failure ? `${run.failure.code}: ${run.failure.message}` : '',
    hasChunks: Boolean(run.retrieval_calls),
    seconds: typeof run.active_ms === 'number' ? Math.round(run.active_ms / 100) / 10 : null,
    llmRequests: run.metrics?.collection === 'collected' && !run.metrics.is_mock ? run.metrics.provider_requests : null,
  };
}

/** Changes whenever a card must be redrawn; stays equal while only the clock moves. */
export const runSignature = (run) => [run.run_id, run.status, run.updated_at, run.retrieval_calls ?? 0].join('|');
