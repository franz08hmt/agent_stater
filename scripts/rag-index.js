// npm run rag:index -- --task=sunrise-clinic-rag [--max-requests=4] [--timeout-ms=60000]
//
// Builds (or rebuilds) the vector index with REAL embeddings from the configured embedding model.
// Calls only the embedding endpoint: no generation LLM. Exit codes: 0 ok, 1 failure, 2 usage,
// 3 BLOCKED (Ollama not running, or the embedding model is not installed).

import { relative } from 'node:path';
import { loadEnvironment } from '../src/operations/context.js';
import { buildTaskIndex, BlockedError } from '../src/rag/indexBuilder.js';
import { publishIndex, describeIndex } from '../src/rag/vectorIndex.js';
import { parseArgs } from '../src/rag/cliArgs.js';

function usage(message) {
  console.error(`${message}\nUsage: npm run rag:index -- --task=<task-id> [--max-requests=1..20] [--timeout-ms=1000..300000]`);
  process.exitCode = 2;
}

let args;
try { args = parseArgs(process.argv.slice(2), { task: 'string', 'max-requests': 'int', 'timeout-ms': 'int' }); } catch (err) { usage(err.message); args = null; }
if (args && !args.task) { usage('--task is required.'); args = null; }

if (args) {
  try {
    const { root, catalog } = await loadEnvironment();
    const entry = catalog.tasks.get(args.task);
    if (!entry) throw new Error(`Unknown task "${args.task}". Registered: ${[...catalog.tasks.keys()].join(', ')}`);
    if (entry.task.retrieval?.kind !== 'vector') throw new Error(`Task "${args.task}" does not declare vector retrieval.`);
    const profile = catalog.embeddingProfiles.get(entry.task.retrieval.embeddingProfileId);
    if (!profile) throw new Error('The embedding profile of this task is not registered in config/catalog.json.');
    const maxRequests = args['max-requests'] ?? 4, timeoutMs = args['timeout-ms'] ?? 60000;
    if (maxRequests < 1 || maxRequests > 20 || timeoutMs < 1000 || timeoutMs > 300000) throw new Error('--max-requests must be 1..20 and --timeout-ms 1000..300000.');

    console.log(`Task ${args.task}: KB "${entry.task.retrieval.kb.title}", ${entry.task.retrieval.kb.chunkCount} chunks (max ${entry.task.retrieval.chunking.max_chars} chars, overlap ${entry.task.retrieval.chunking.overlap_chars}).`);
    console.log(`Embedding model ${profile.name} (profile ${profile.id}), request cap ${maxRequests}, timeout ${timeoutMs} ms.`);
    const { doc, accounting, inspected } = await buildTaskIndex({ task: entry.task, profile, maxRequests, timeoutMs });
    await publishIndex(entry.task.retrieval.indexFile, doc);
    const meta = describeIndex(doc);
    console.log('\nINDEX BUILT');
    console.log(`  file          ${relative(root, entry.task.retrieval.indexFile).replaceAll('\\', '/')}  (Git-ignored runtime data)`);
    console.log(`  index_id      ${meta.index_id}`);
    console.log(`  chunks        ${meta.chunk_count}`);
    console.log(`  embedding     ${meta.embedding.name}  digest ${inspected.digest ? inspected.digest.slice(0, 12) : 'unavailable'}  dimension ${meta.embedding.dimension}`);
    console.log(`  kb checksum   ${meta.kb_checksum_sha256}`);
    console.log(`  embedding HTTP requests ${accounting.requests}/${accounting.max_requests}, failed ${accounting.failed}, ${accounting.ms} ms, input tokens ${accounting.input_tokens_reported ?? 'unavailable'}${accounting.usage_missing_requests ? ` (usage missing on ${accounting.usage_missing_requests} request(s))` : ''}`);
    console.log('  generation LLM calls 0');
    console.log('\nRestart the server (npm run exam:start) so it loads the new index.');
  } catch (err) {
    if (err instanceof BlockedError) {
      console.error(`BLOCKED: ${err.message}\n  ${err.hint}`);
      process.exitCode = 3;
    } else {
      console.error(`FAILED: ${err.message}`);
      process.exitCode = 1;
    }
  }
}
