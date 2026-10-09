// Runs acceptance cases through the REAL catalog / run manager / retriever / store and grades them with
// src/rag/acceptance.js. It is the shared core of `npm run rag:eval` (mock harness and local live sessions).
//
// Session accounting (never raised silently):
//   - every run gets its own run manager whose per-run provider and embedding limits are clamped to what is left
//     of the session cap, so a session can never send more HTTP requests than its cap;
//   - the first provider failure (rate limit, model unavailable, timeout) or an embedding-service failure stops the
//     session: the remaining cases are NOT_RUN, so no quota is spent on a service that is down;
//   - requests are read from each run's own metrics (generation: run.metrics.provider_requests, embedding:
//     run.metrics.embeddings.requests), never from a shared counter.

import { gradeCase, summarizeResults } from './acceptance.js';
import { createRunManager } from '../agent/runManager.js';

export const MAX_SESSION_CAP = 24;

const providerFailure = (run) => Boolean(run?.failure?.code?.startsWith('model_'));

/** Union of source ids the retriever actually showed to the model in this run (the same data as the debug view). */
function shownIds(retrieval) {
  return [...new Set((retrieval?.calls ?? []).flatMap((call) => call.items.map((item) => item.source_id)))];
}

/**
 * @param options.catalog      loaded catalog (real or temporary project)
 * @param options.config       agent config (limits are cloned and clamped per run)
 * @param options.store        file store for the session's run artifacts (a fresh directory)
 * @param options.testCases    cases to run, already ordered
 * @param options.taskId, options.profileId
 * @param options.caps         { generation, embedding } session caps, each <= MAX_SESSION_CAP
 * @param options.used         requests already spent in this session (warm / probe / index): { generation, embedding }
 * @param options.repeat       trials per case
 * @param options.prepare      optional (testCase) => void, called before each run (the mock harness installs its scripted model here)
 * @param options.onResult     optional progress callback
 * @param options.capLimit     upper bound for the caps (default 24; only the offline mock harness may raise it)
 */
export async function runAcceptanceCampaign({ catalog, config, store, testCases, taskId, profileId, caps, used = { generation: 0, embedding: 0 }, repeat = 1, prepare, onResult, capLimit = MAX_SESSION_CAP }) {
  // capLimit is only raised by the offline harness (fake HTTP). Live sessions always use the 24-request limit.
  for (const [name, value] of Object.entries(caps)) if (!Number.isInteger(value) || value < 1 || value > capLimit) throw new Error(`The ${name} cap must be an integer between 1 and ${capLimit}.`);
  const session = { caps: { ...caps }, used: { ...used }, stopped: null };
  const results = [];
  for (const testCase of testCases) for (let trial = 1; trial <= repeat; trial += 1) {
    const base = { trial };
    const notRun = (reason) => ({ ...gradeCase(testCase, { state: 'not_run', reason }), ...base });
    let result;
    if (session.stopped) result = notRun(`session stopped: ${session.stopped}`);
    else if (session.caps.generation - session.used.generation < 1 && !catalog.profiles.get(profileId).metadata.is_mock) result = notRun('generation request cap reached');
    else if (session.caps.embedding - session.used.embedding < 1) result = notRun('embedding request cap reached');
    else {
      prepare?.(testCase);
      const limits = { ...config.limits,
        maxProviderRequests: Math.max(1, Math.min(config.limits.maxProviderRequests, session.caps.generation - session.used.generation)),
        maxEmbeddingRequests: Math.max(1, Math.min(config.limits.maxEmbeddingRequests, session.caps.embedding - session.used.embedding)) };
      const manager = createRunManager({ catalog, store, limits, modelTimeoutMs: config.model.timeoutMs });
      await manager.init();
      let run = null, retrieval = null, error = null;
      try {
        const started = await manager.startRun(testCase.goal, { task_id: taskId, model_profile_id: profileId });
        await manager.idle(started.run_id);
        run = manager.getRun(started.run_id);
        retrieval = manager.getRetrieval(started.run_id);
      } catch (err) { error = err; }

      const generation = run?.metrics?.collection === 'collected' ? run.metrics : null;
      session.used.generation += generation?.is_mock ? 0 : generation?.provider_requests ?? 0;
      session.used.embedding += run?.metrics?.embeddings?.requests ?? 0;
      const embedFailed = (run?.metrics?.embeddings?.failed ?? 0) > 0 && !(run?.retrieval_calls > 0);
      let outcome;
      if (error) outcome = { state: 'failed', failure: { code: error.code ?? 'start_failed' }, reason: error.message };
      else if (providerFailure(run)) { outcome = { state: 'blocked', reason: `${run.failure.code}: ${run.failure.message}`.slice(0, 220) }; session.stopped = run.failure.code; }
      else if (embedFailed && run.status !== 'completed') { outcome = { state: 'blocked', reason: 'embedding service failed during retrieval' }; session.stopped = 'embedding_unavailable'; }
      else if (embedFailed) { outcome = { state: 'blocked', reason: 'embedding service failed during retrieval; the answer was produced without chunks' }; session.stopped = 'embedding_unavailable'; }
      else if (run.status === 'completed' && run.final) outcome = { state: 'completed', answer: run.final.answer, source_ids: run.final.source_ids, unresolved: run.final.unresolved, retrieved_ids: shownIds(retrieval) };
      else outcome = { state: run.status === 'stopped' ? 'stopped' : 'failed', failure: run.failure };
      result = { ...gradeCase(testCase, outcome), ...base, run_id: run?.run_id ?? null, run_status: run?.status ?? null,
        answer: run?.final?.answer ?? null, source_ids: run?.final?.source_ids ?? null, unresolved: run?.final?.unresolved ?? null,
        failure: run?.failure ?? (error ? { code: error.code ?? 'start_failed', message: error.message } : null),
        retrieved: (retrieval?.calls ?? []).map((call) => ({ query: call.query, chunks: call.items.map((i) => ({ source_id: i.source_id, match: i.match, rank: i.rank, score: i.score })) })),
        generation: generation && { provider_requests: generation.provider_requests, model_calls: generation.model_calls, repairs: generation.repairs, retries: generation.retries, is_mock: generation.is_mock, tokens: generation.tokens?.reported ?? null },
        embeddings: run?.metrics?.embeddings ? { requests: run.metrics.embeddings.requests, failed: run.metrics.embeddings.failed, tokens: run.metrics.embeddings.tokens.reported_input } : null };
    }
    results.push(result);
    onResult?.(result);
  }
  return { results, session, summary: summarizeResults(results) };
}
