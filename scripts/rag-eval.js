// npm run rag:eval -- --profile=mock                         offline harness: fake embeddings + scripted model (wiring only)
// npm run rag:eval -- --profile=ollama-qwen3 --live --plan    metadata-only preflight, sends no generation/embedding request
// npm run rag:eval -- --profile=ollama-qwen3 --live           LOCAL live session (priority cases, sequential, hard caps)
// npm run rag:eval -- --profile=ollama-qwen3 --live --fake-embeddings   HYBRID probe: real local LLM + FAKE embeddings (only when the embedding model is not installed)
//   options: --only=S01,S02  --all  --repeat=1..3  --max-generation=1..24  --max-embedding=1..24  --embedding-spent=N  --json
//
// Statuses per case: PASS | FAIL | REVIEW_REQUIRED | BLOCKED | NOT_RUN. PASS = every automatic check passed; it does not
// prove the prose is right. A mock PASS is harness evidence only. Exit codes: 0 all PASS, 1 FAIL, 2 usage, 3 BLOCKED, 4 needs review / incomplete.

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadEnvironment, PROJECT_ROOT } from '../src/operations/context.js';
import { localEndpoint, inspectLocalModel } from '../src/operations/localModel.js';
import { createCampaignSession, campaignCheck } from '../src/operations/campaign.js';
import { createFileStore } from '../src/store/fileStore.js';
import { createOllamaEmbedder, EmbeddingError } from '../src/rag/embedding.js';
import { validateManifest, summarizeResults } from '../src/rag/acceptance.js';
import { runAcceptanceCampaign, MAX_SESSION_CAP } from '../src/rag/evalRunner.js';
import { parseArgs } from '../src/rag/cliArgs.js';
import { createMockHarness, readManifest } from '../eval/sunrise-mock.js';

const usage = (message) => { console.error(`${message}\nUsage: npm run rag:eval -- --profile=mock | --profile=<local-profile> --live [--plan] [--fake-embeddings] [--only=S01,S02] [--all] [--repeat=1..3] [--max-generation=1..24] [--max-embedding=1..24] [--embedding-spent=N] [--json]`); process.exitCode = 2; };

let args;
try { args = parseArgs(process.argv.slice(2), { profile: 'string', live: 'flag', plan: 'flag', only: 'string', all: 'flag', 'fake-embeddings': 'flag', repeat: 'int', 'max-generation': 'int', 'max-embedding': 'int', 'embedding-spent': 'int', json: 'flag' }); } catch (err) { usage(err.message); args = null; }
if (args && !args.profile) { usage('--profile is required.'); args = null; }
if (args && args.profile !== 'mock' && !args.live) { usage(`Profile "${args.profile}" would send real requests to local services. Add --live to confirm (and --plan to only run the metadata preflight).`); args = null; }
if (args && args.profile === 'mock' && (args.live || args.plan || args['fake-embeddings'])) { usage('--live, --plan and --fake-embeddings do not apply to the offline mock profile.'); args = null; }
const repeat = args?.repeat ?? 1;
if (args && (repeat < 1 || repeat > 3)) { usage('--repeat must be 1..3.'); args = null; }

class UsageError extends Error {}
const reportDir = (root) => join(root, 'var', 'rag-eval');
async function saveReport(root, mode, body) {
  const id = randomUUID();
  await mkdir(reportDir(root), { recursive: true });
  const file = join(reportDir(root), `rag-eval-${mode}-${id}.json`);
  await writeFile(file, JSON.stringify({ version: 1, kind: 'rag-eval', mode, session_id: id, at: new Date().toISOString(), ...body }, null, 2), { flag: 'wx' });
  return file;
}
const line = (r) => `${r.status.padEnd(16)}${r.id}${r.trial > 1 ? `#${r.trial}` : ''}  ${(r.title ?? '').slice(0, 52)}${r.cited_sections ? `  cited §${r.cited_sections.join(',§') || '-'}` : ''}`;

function print(results, summary, session, { showAnswers }) {
  for (const r of results) {
    console.log(line(r));
    for (const reason of r.reasons ?? []) console.log(`                  ${reason}`);
    if (showAnswers && r.answer) {
      console.log(`                  answer: ${r.answer.replace(/\s+/g, ' ')}`);
      console.log(`                  sources: ${(r.source_ids ?? []).join(', ') || 'none'}${r.unresolved ? ` | unresolved: ${r.unresolved}` : ''}`);
    }
  }
  const c = summary.counts;
  console.log(`\n${c.PASS} PASS, ${c.FAIL} FAIL, ${c.REVIEW_REQUIRED} REVIEW_REQUIRED, ${c.BLOCKED} BLOCKED, ${c.NOT_RUN} NOT_RUN of ${results.length} -> ${summary.status}${summary.complete ? '' : ' (incomplete)'}`);
  const cap = (n) => (n >= 1000 ? 'no cap (fake HTTP)' : n);
  console.log(`Requests: generation ${session.used.generation}/${cap(session.caps.generation)}, embedding ${session.used.embedding}/${cap(session.caps.embedding)}${session.stopped ? `; session stopped: ${session.stopped}` : ''}`);
}

async function mock() {
  const { manifest, reference } = await readManifest();
  const harness = await createMockHarness({ reference });
  try {
    const sections = [...new Set(harness.catalog.tasks.get(manifest.task_id).task.retrieval.kb.chunks.map((chunk) => chunk.section_number))];
    const problems = validateManifest(manifest, { sectionNumbers: sections });
    if (problems.length) throw new Error(`Invalid acceptance manifest: ${problems.join('; ')}`);
    const ids = args.only ? args.only.split(',') : manifest.cases.map((c) => c.id);
    const unknown = ids.filter((id) => !manifest.cases.some((c) => c.id === id));
    if (unknown.length) throw new UsageError(`Unknown case id(s): ${unknown.join(', ')}`);
    const testCases = ids.map((id) => manifest.cases.find((c) => c.id === id));
    console.log('MOCK harness: fake embeddings (hashed bag of words) + scripted model replaying hand-written answers.\nThis proves the wiring, the grounding rules and the grader. It is NOT evidence about a real LLM or a real embedding model.\n');
    const out = await runAcceptanceCampaign({ catalog: harness.catalog, config: harness.config, store: harness.store, testCases, taskId: manifest.task_id, profileId: harness.mockProfileId,
      caps: { generation: 1000, embedding: 1000 }, capLimit: 1000, repeat, prepare: (c) => harness.prepare(c) });
    print(out.results, out.summary, out.session, { showAnswers: false });
    console.log(`Fake embedding HTTP requests: ${harness.embedRequests()} (index ${harness.indexRequests} + ${out.session.used.embedding} queries); real LLM requests 0; cloud requests 0.`);
    const file = await saveReport(PROJECT_ROOT, 'mock', { label: 'MOCK harness evidence only', results: out.results, summary: out.summary, session: out.session });
    console.log(`Report: ${file}`);
    process.exitCode = out.summary.exit_code;
  } finally { await harness.close(); }
}

async function live() {
  const env = await loadEnvironment();
  const { manifest } = await readManifest(env.root);
  // HYBRID: a temporary project whose embedding endpoint is the fake hashed bag-of-words server; the LLM is still the real local one.
  const harness = args['fake-embeddings'] ? await createMockHarness({ reference: {} }) : null;
  try { await liveSession(env, manifest, harness); } finally { await harness?.close(); }
}

async function liveSession(env, manifest, harness) {
  const hybrid = Boolean(harness);
  const catalog = harness?.catalog ?? env.catalog, config = harness?.config ?? env.config;
  const entry = catalog.tasks.get(manifest.task_id);
  if (!entry || entry.task.retrieval?.kind !== 'vector') throw new Error(`Task "${manifest.task_id}" is not registered with vector retrieval.`);
  const problems = validateManifest(manifest, { sectionNumbers: [...new Set(entry.task.retrieval.kb.chunks.map((c) => c.section_number))] });
  if (problems.length) throw new Error(`Invalid acceptance manifest: ${problems.join('; ')}`);
  const profile = catalog.profiles.get(args.profile);
  if (!profile) throw new UsageError(`Unknown model profile "${args.profile}". Registered: ${[...catalog.profiles.keys()].join(', ')}`);
  localEndpoint(profile); // throws unless this is a real LOCAL profile: this command never calls a cloud service
  const caps = { generation: args['max-generation'] ?? MAX_SESSION_CAP, embedding: args['max-embedding'] ?? MAX_SESSION_CAP };
  for (const [k, v] of Object.entries(caps)) if (v < 1 || v > MAX_SESSION_CAP) throw new UsageError(`--max-${k} must be 1..${MAX_SESSION_CAP}.`);

  const ids = args.only ? args.only.split(',') : args.all ? manifest.cases.map((c) => c.id) : manifest.live_priority;
  const unknown = ids.filter((id) => !manifest.cases.some((c) => c.id === id));
  if (unknown.length) throw new UsageError(`Unknown case id(s): ${unknown.join(', ')}`);
  const testCases = ids.map((id) => manifest.cases.find((c) => c.id === id));

  const label = hybrid ? 'HYBRID probe: real local LLM + FAKE hashed bag-of-words embeddings (NOT embeddinggemma)' : 'LIVE local session';
  const identities = { llm: { ...profile.metadata, identity: profile.identity }, task: { id: manifest.task_id, fingerprint: entry.task.fingerprint }, index: entry.retriever.index ?? null,
    commit: env.evidenceContext.commit, working_tree_modified: env.evidenceContext.working_tree_modified, configuration_id: env.service.configuration_id };
  const blocked = async (reason, extra = {}) => {
    const results = testCases.flatMap((c) => Array.from({ length: repeat }, (_, i) => ({ id: c.id, title: c.title, trial: i + 1, status: 'BLOCKED', reasons: [reason] })));
    const summary = summarizeResults(results);
    console.error(`BLOCKED: ${reason}`);
    const file = await saveReport(env.root, hybrid ? 'hybrid' : 'live', { label: `${label} (blocked before any request)`, identities, results, summary, ...extra });
    console.error(`Report: ${file}`);
    process.exitCode = 3;
  };

  if (!entry.retriever.ready) return blocked(`the vector index is ${entry.retriever.status}: ${entry.retriever.reason} Build it with: npm run rag:index -- --task=${manifest.task_id}, then restart.`);
  const embedProfile = catalog.embeddingProfiles.get(entry.task.retrieval.embeddingProfileId);
  if (hybrid) identities.embedding = { name: 'FAKE hashed bag-of-words (test double)', real: false, dimension: entry.retriever.index.embedding.dimension };
  else {
    const embedder = createOllamaEmbedder(embedProfile);
    let installed;
    try { installed = await embedder.inspect(); } catch (err) { if (err instanceof EmbeddingError && ['unavailable', 'timeout'].includes(err.kind)) return blocked(`Ollama is not reachable for embeddings (${err.message}). Start it yourself; nothing was sent.`); throw err; }
    if (!installed.installed) return blocked(`the embedding model "${embedProfile.name}" is not installed. Install it yourself (about 622 MB): ollama pull ${embedProfile.name}  (Without it only the labelled HYBRID probe is possible: add --fake-embeddings. That does NOT verify real retrieval.)`);
    const indexDigest = entry.retriever.index.embedding.digest;
    if (indexDigest && installed.digest && indexDigest !== installed.digest) throw new Error(`The installed ${embedProfile.name} (digest ${installed.digest.slice(0, 12)}) differs from the one that built the index (${indexDigest.slice(0, 12)}). Rebuild: npm run rag:index -- --task=${manifest.task_id}`);
    identities.embedding = { name: embedProfile.name, digest: installed.digest ?? null, dimension: entry.retriever.index.embedding.dimension, preprocessing_version: embedProfile.preprocessingVersion, real: true };
  }
  const local = await inspectLocalModel(profile);
  identities.llm_inspect = local;
  if (local.status !== 'PASS') return blocked(local.suggestion);

  // Embedding requests already spent on the index of THIS session's index (recorded by rag:index) plus anything the user reports.
  let spent = (args['embedding-spent'] ?? 0) + (hybrid ? harness.indexRequests : 0);
  if (!hybrid) try { const rec = JSON.parse(await readFile(join(env.root, 'var', 'rag', manifest.task_id, 'index-build.json'), 'utf8')); if (rec.index_id === entry.retriever.index.index_id) spent += rec.embedding_requests; } catch { /* no side record: only --embedding-spent counts */ }
  if (spent >= caps.embedding) return blocked(`the ${caps.embedding}-request embedding cap is already used (${spent} spent on indexing/debugging). No query embedding would be possible.`);

  console.log(`${hybrid ? 'HYBRID' : 'LIVE'} (local only): LLM ${profile.metadata.name} via profile ${args.profile}, embedding ${hybrid ? 'FAKE hashed bag-of-words (a test double, not a real model)' : `${embedProfile.name} (${identities.embedding.digest?.slice(0, 12) ?? 'digest unavailable'})`}, index ${entry.retriever.index.index_id.slice(0, 12)}.`);
  if (hybrid) console.log("This probes the real LLM's protocol, grounding, language and abstention behaviour. It does NOT verify embeddinggemma or real retrieval quality.");
  console.log(`Cases (${testCases.length}${repeat > 1 ? ` x${repeat}` : ''}): ${ids.join(', ')}. Caps: generation ${caps.generation}, embedding ${caps.embedding} (embedding already spent: ${spent}). Sequential; no retry, no cloud, no download.`);
  if (env.evidenceContext.working_tree_modified) console.log('Note: the working tree has uncommitted changes; the report records this.');
  if (args.plan) { console.log('--plan: preflight only: no LLM request and no real embedding request was sent.'); return; }

  const session = createCampaignSession(caps.generation);
  const checks = [];
  for (const kind of ['warm', 'probe']) {
    const check = await campaignCheck(session, profile, kind);
    checks.push({ kind, status: check.status, error: check.error ?? null, metrics: check.metrics ?? null });
    console.log(`${kind.padEnd(6)} ${check.status} (generation requests ${session.used}/${caps.generation})`);
    if (check.status !== 'PASS') return blocked(`the local model failed its ${kind} check (${check.error?.message ?? check.status}); no case was run.`, { checks, session });
  }
  const store = await createFileStore({ root: join(env.root, 'var', 'rag-eval', `session-${randomUUID()}`) });
  const out = await runAcceptanceCampaign({ catalog, config, store, testCases, taskId: manifest.task_id, profileId: args.profile, caps, repeat,
    used: { generation: session.used, embedding: spent }, onResult: (r) => { if (!args.json) console.log(`  … ${r.id}#${r.trial} ${r.status}`); } });
  console.log('');
  print(out.results, out.summary, out.session, { showAnswers: true });
  console.log('Automatic checks only: read the answers above. PASS does not verify every prose claim, and these results cover only the cases listed.');
  const file = await saveReport(env.root, hybrid ? 'hybrid' : 'live', { label, identities, checks, caps, results: out.results, summary: out.summary, session: out.session });
  console.log(`Report: ${file}`);
  if (args.json) console.log(JSON.stringify({ summary: out.summary, session: out.session }, null, 2));
  process.exitCode = out.summary.exit_code;
}

if (args) {
  try { await (args.profile === 'mock' ? mock() : live()); } catch (err) { if (err instanceof UsageError) usage(err.message); else { console.error(`FAILED: ${err.message}`); process.exitCode = 1; } }
}
