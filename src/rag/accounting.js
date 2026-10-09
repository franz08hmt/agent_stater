// Per-run accounting for query-embedding HTTP requests, kept separate from LLM metrics:
// an embedding request is not a model.complete() call and its tokens are not LLM tokens.
//
// - the request is counted BEFORE the HTTP call, so a crash cannot hide it;
// - failures and timeouts are counted as requests too;
// - missing or invalid usage stays "unavailable" and is never turned into 0;
// - state lives in run.metrics.embeddings (one object per run), never in a shared retriever;
// - before() persists the counted request (awaited, before the HTTP call); after() only updates memory.

import { BudgetError } from '../agent/metrics.js';

export const DEFAULT_EMBEDDING_REQUEST_LIMIT = 3;

export function createEmbeddingMetrics(limit = DEFAULT_EMBEDDING_REQUEST_LIMIT) {
  return {
    version: 1, scope: 'query', limits: { requests: limit },
    requests: 0, failed: 0, pending: 0, inputs: 0, ms: 0,
    tokens: { reported_input: null, reported_requests: 0, unavailable_requests: 0, invalid_usage_requests: 0, policy: 'ollama-prompt-eval-count' },
  };
}

/**
 * Hook object for the embedder: { before(), after(result) }.
 * before() may throw BudgetError; the embedder then sends nothing.
 */
export function embeddingAccounting(run, { limit, persist } = {}) {
  const metrics = run.metrics;
  const save = () => Promise.resolve(persist?.()).catch(() => {});
  return {
    async before() {
      if (!metrics || metrics.collection !== 'collected') throw new BudgetError('metrics_unavailable', 'This run has no collected accounting; embedding is refused.');
      const e = (metrics.embeddings ??= createEmbeddingMetrics(limit));
      if (e.requests >= e.limits.requests) throw new BudgetError('embedding_budget', `Embedding request budget exhausted (${e.requests}/${e.limits.requests}); no further retrieval is possible in this run.`);
      e.requests += 1;
      e.pending += 1;
      await save();
    },
    after({ ok, usage, ms, inputs }) {
      const e = metrics.embeddings;
      e.pending = Math.max(0, e.pending - 1);
      e.ms += ms;
      e.inputs += inputs;
      if (!ok) e.failed += 1;
      if (ok && usage?.valid && Number.isSafeInteger((e.tokens.reported_input ?? 0) + usage.input_tokens)) {
        e.tokens.reported_input = (e.tokens.reported_input ?? 0) + usage.input_tokens;
        e.tokens.reported_requests += 1;
      } else {
        e.tokens.unavailable_requests += 1;
        if (ok && usage?.present && !usage.valid) e.tokens.invalid_usage_requests += 1;
      }
      // No persist here on purpose: the runner always persists right after the tool returns, and a
      // second concurrent write of the same run file races on Windows (EPERM on rename).
    },
  };
}
