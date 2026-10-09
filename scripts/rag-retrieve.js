// npm run rag:retrieve -- --task=sunrise-clinic-rag --query="What is the current dermatology fee?" [--json] [--max-requests=1]
//
// The debug view for ONE question: embeds the query with the index's own encoder, ranks every
// chunk by cosine similarity, and prints what would be given to the LLM (top-k plus required
// sections). No generation LLM is called. Exit codes: 0 ok, 1 failure, 2 usage, 3 BLOCKED
// (no usable index, or Ollama / the embedding model is unavailable).

import { loadEnvironment } from '../src/operations/context.js';
import { parseArgs } from '../src/rag/cliArgs.js';
import { createOllamaEmbedder, EmbeddingError } from '../src/rag/embedding.js';
import { newBuildAccounting } from '../src/rag/indexBuilder.js';

function usage(message) {
  console.error(`${message}\nUsage: npm run rag:retrieve -- --task=<task-id> --query="<question>" [--json] [--max-requests=1..5]`);
  process.exitCode = 2;
}

let args;
try { args = parseArgs(process.argv.slice(2), { task: 'string', query: 'string', json: 'flag', 'max-requests': 'int' }); } catch (err) { usage(err.message); args = null; }
if (args && (!args.task || !args.query)) { usage('--task and --query are required.'); args = null; }
if (args && (args.query.length < 2 || args.query.length > 300)) { usage('--query must be 2..300 characters.'); args = null; }

if (args) {
  try {
    const { catalog } = await loadEnvironment();
    const entry = catalog.tasks.get(args.task);
    if (!entry) throw new Error(`Unknown task "${args.task}".`);
    const retriever = entry.retriever;
    if (retriever.kind !== 'vector-cosine') throw new Error(`Task "${args.task}" does not use vector retrieval.`);
    if (!retriever.ready) {
      console.error(`BLOCKED: the vector index is ${retriever.status}: ${retriever.reason}\n  Build it with: npm run rag:index -- --task=${args.task}`);
      process.exitCode = 3;
    } else {
      const profile = catalog.embeddingProfiles.get(entry.task.retrieval.embeddingProfileId);
      const embedder = createOllamaEmbedder(profile);
      // The index was built with a specific model build; a different digest means different vectors.
      const installed = await embedder.inspect().catch((err) => { throw (err instanceof EmbeddingError && ['unavailable', 'timeout'].includes(err.kind) ? Object.assign(err, { blocked: true }) : err); });
      if (!installed.installed) { console.error(`BLOCKED: the embedding model "${profile.name}" is not installed.\n  Install it yourself: ollama pull ${profile.name}`); process.exitCode = 3; }
      else if (retriever.index.embedding.digest && installed.digest && retriever.index.embedding.digest !== installed.digest) {
        throw new Error(`The installed ${profile.name} (digest ${installed.digest.slice(0, 12)}) differs from the one that built the index (${retriever.index.embedding.digest.slice(0, 12)}). Rebuild: npm run rag:index -- --task=${args.task}`);
      } else {
        const accounting = newBuildAccounting(args['max-requests'] ?? 1);
        const result = await retriever.search(args.query, { accounting: accounting.hooks, includeRanking: true });
        const totals = accounting.totals;
        if (args.json) console.log(JSON.stringify({ task: args.task, index: retriever.index, embedding_requests: totals, ...result }, null, 2));
        else {
          const m = retriever.index;
          console.log(`Query: ${result.query}`);
          console.log(`Index ${m.index_id.slice(0, 12)}  KB "${m.kb_title}"  ${m.chunk_count} chunks  encoder ${m.embedding.name} (${m.embedding.dimension} dims)  similarity: exact cosine`);
          console.log(`Embedding HTTP requests ${totals.requests}/${totals.max_requests}, ${totals.ms} ms, input tokens ${totals.input_tokens_reported ?? 'unavailable'}; generation LLM calls 0`);
          console.log(`Policy: top_k ${retriever.config.topK} + required sections [${retriever.config.requiredSections.join(', ')}]; context budget ${retriever.config.context.maxChars} chars\n`);
          console.log('FULL RANKING (every chunk):');
          for (const r of result.ranking) console.log(`  #${String(r.rank).padStart(2)}  ${r.score.toFixed(4)}  ${r.source_id.padEnd(12)} ${r.section}`);
          console.log(`\nCHUNKS GIVEN TO THE MODEL (${result.count}${result.omitted_semantic_matches ? `, ${result.omitted_semantic_matches} semantic match(es) dropped by the size budget` : ''}):`);
          for (const item of result.results) {
            console.log(`\n--- ${item.source_id} | ${item.section} | match=${item.match} | rank #${item.rank} | score ${item.score.toFixed(4)}`);
            console.log(item.text.split('\n').map((line) => `    ${line}`).join('\n'));
          }
        }
      }
    }
  } catch (err) {
    if (err.blocked) { console.error(`BLOCKED: ${err.message}\n  Start Ollama and retry.`); process.exitCode = 3; }
    else { console.error(`FAILED: ${err.message}`); process.exitCode = 1; }
  }
}
