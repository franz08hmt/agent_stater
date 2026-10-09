// Vector retriever: query -> embedding (same encoder as the index) -> exact cosine ranking ->
// top-k semantic chunks + backend-owned REQUIRED sections -> context packed into a bounded size.
//
// Required context is a rule of the task declaration (for example "section 10 overrides earlier
// sections"), not a hard-coded answer: it makes sure the overriding text can never be missed
// because of a ranking accident. Every item says WHY it is in the context (semantic / required).
//
// What this object returns is exactly what the model is shown and what grounding trusts:
// anything dropped by the size budget is not returned, not cited, and not grounded.

import { describeIndex, prepareVectors, cosineRank } from './vectorIndex.js';

const round = (n) => Math.round(n * 10000) / 10000;

/** Size of the observation the runner will build around a result, plus a safety margin for its header. */
const OBSERVATION_OVERHEAD = 220;
const observationSize = (payload) => JSON.stringify({ tool: 'search_kb', status: 'ok', untrusted_data: payload }).length + OBSERVATION_OVERHEAD;

/**
 * @param retrieval validated task retrieval declaration (top_k, required_sections, context, ...)
 * @param indexState result of readIndexState(): { status, reason, doc? }
 */
export function createVectorRetriever({ retrieval, embedder, indexState }) {
  const ready = indexState.status === 'ready' && Boolean(embedder);
  const doc = ready ? indexState.doc : null;
  const prepared = ready ? prepareVectors(doc) : [];
  const ids = new Set(doc?.chunks.map((c) => c.source_id) ?? []);
  const required = new Set(retrieval.requiredSections);

  return {
    kind: 'vector-cosine',
    ready,
    status: indexState.status,
    reason: ready ? null : indexState.reason ?? 'Embedding profile is not configured.',
    sourceCount: doc?.chunks.length ?? 0,
    config: { topK: retrieval.topK, requiredSections: [...retrieval.requiredSections], context: { ...retrieval.context } },
    index: doc ? describeIndex(doc) : null,
    embedder,
    has: (sourceId) => ids.has(sourceId),
    describe: () => (doc?.chunks ?? []).slice(0, 40).map((c) => ({ source_id: c.source_id, title: c.section_label.slice(0, 120), passage_count: 1 })),

    /**
     * @returns {{query, index_id, count, results:object[], omitted_semantic_matches:number}}
     */
    async search(query, { signal, accounting, includeRanking = false } = {}) {
      if (!ready) throw new Error(`The vector index is not ready (${indexState.status}): ${indexState.reason ?? 'no embedding profile'}`);
      const { vectors } = await embedder.embed([embedder.queryText(query)], { signal, accounting, expectedDimension: doc.embedding.dimension });
      const ranked = cosineRank(prepared, vectors[0]);
      const rankOf = new Map(ranked.map((r, position) => [r.index, { rank: position + 1, score: r.score }]));
      const semantic = ranked.slice(0, retrieval.topK).map((r) => r.index);
      const forced = doc.chunks.map((c, index) => ({ c, index })).filter(({ c, index }) => required.has(c.section_number) && !semantic.includes(index)).map(({ index }) => index);

      const entry = (index, match) => {
        const c = doc.chunks[index];
        const { rank, score } = rankOf.get(index);
        const isRequired = required.has(c.section_number);
        return {
          source_id: c.source_id, section: c.section_label, chunk: `${c.chunk_number}/${c.chunk_count}`,
          match: match === 'semantic' && isRequired ? 'semantic+required' : match, rank, score: round(score), text: c.text,
        };
      };
      let items = [...semantic.map((i) => entry(i, 'semantic')), ...forced.map((i) => entry(i, 'required'))];
      if (items.length > retrieval.context.maxChunks) {
        // Required chunks are never dropped; the weakest semantic matches go first.
        const keepRequired = items.filter((x) => x.match !== 'semantic');
        const room = Math.max(0, retrieval.context.maxChunks - keepRequired.length);
        const keepSemantic = items.filter((x) => x.match === 'semantic').slice(0, room);
        items = items.filter((x) => keepRequired.includes(x) || keepSemantic.includes(x));
      }
      let omitted = semantic.length + forced.length - items.length;
      const payload = () => ({ query, index_id: doc.index_id, count: items.length, results: items, omitted_semantic_matches: omitted });
      while (observationSize(payload()) > retrieval.context.maxChars) {
        const weakest = [...items].reverse().findIndex((x) => x.match === 'semantic');
        if (weakest < 0) throw new Error(`The required context alone exceeds the ${retrieval.context.maxChars}-character context budget; reduce required_sections or raise context.max_chars.`);
        items.splice(items.length - 1 - weakest, 1);
        omitted += 1;
      }
      return includeRanking
        ? { ...payload(), ranking: ranked.map((r, position) => ({ rank: position + 1, source_id: doc.chunks[r.index].source_id, section: doc.chunks[r.index].section_label, score: round(r.score) })) }
        : payload();
    },
  };
}
