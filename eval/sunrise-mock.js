// Offline harness for the Sunrise acceptance run: the real catalog, task, index, run manager, retriever, store and
// grader, with a FAKE Ollama (hashed bag-of-words "embeddings") and a SCRIPTED model that replays the hand-written
// answers in eval/sunrise-reference-answers.json. Everything is local and temporary.
//
// A PASS here proves the harness wiring, the grounding rules and the grader. It says NOTHING about a real LLM or a
// real embedding model; the output and the report are labelled accordingly.

import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config/agent.config.js';
import { loadCatalog } from '../config/catalog.config.js';
import { createFileStore } from '../src/store/fileStore.js';
import { createScriptedModel } from '../src/model/mock.js';
import { buildTaskIndex } from '../src/rag/indexBuilder.js';
import { publishIndex } from '../src/rag/vectorIndex.js';
import { startFakeOllama } from './fake-ollama.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const SUNRISE_TASK = 'sunrise-clinic-rag';
export const EMBEDDING_PROFILE = 'ollama-embeddinggemma';

export async function readManifest(root = ROOT) {
  return {
    manifest: JSON.parse(await readFile(join(root, 'eval', 'sunrise-acceptance.json'), 'utf8')),
    reference: JSON.parse(await readFile(join(root, 'eval', 'sunrise-reference-answers.json'), 'utf8')).answers,
  };
}

/** @returns {Promise<{catalog, config, store, prepare(testCase), embedRequests(), close()}>} */
export async function createMockHarness({ reference, root = ROOT, ollama = {}, buildIndex = true }) {
  const dir = await mkdtemp(join(tmpdir(), 'sunrise-mock-eval-'));
  const fake = await startFakeOllama(ollama);
  try {
    for (const folder of ['config', 'data']) await cp(join(root, folder), join(dir, folder), { recursive: true });
    const catalogFile = join(dir, 'config', 'catalog.json');
    const raw = JSON.parse(await readFile(catalogFile, 'utf8'));
    const profile = raw.embedding_profiles.find((p) => p.id === EMBEDDING_PROFILE);
    profile.base_url = fake.baseUrl;
    await writeFile(catalogFile, JSON.stringify(raw, null, 2));
    const config = loadConfig();
    const first = await loadCatalog({ root: dir, config });
    const entry = first.tasks.get(SUNRISE_TASK);
    const built = await buildTaskIndex({ task: entry.task, profile: first.embeddingProfiles.get(EMBEDDING_PROFILE), createdAt: '2026-10-09T00:00:00.000Z' });
    await publishIndex(entry.task.retrieval.indexFile, built.doc);
    const catalog = await loadCatalog({ root: dir, config });
    const store = await createFileStore({ root: join(dir, 'var') });
    const mock = catalog.profiles.get('mock');
    if (!mock?.metadata.is_mock) throw new Error('The offline harness needs the "mock" model profile.');

    return {
      catalog, config, store, mockProfileId: 'mock',
      indexRequests: built.accounting.requests,
      embedRequests: () => fake.embedHits().length,
      /** Installs a scripted model for this case: search once, then answer from what was actually shown. */
      prepare(testCase) {
        const ref = reference[testCase.id];
        if (!ref) throw new Error(`No reference answer for case ${testCase.id}.`);
        mock.model = createScriptedModel([
          JSON.stringify({ type: 'tool_call', tool: 'search_kb', arguments: { query: ref.query } }),
          ...(ref.calc ? [JSON.stringify({ type: 'tool_call', tool: 'calculate', arguments: { expression: ref.calc } })] : []),
          (messages) => {
            const shown = new Set(messages.map((m) => m.content).join(' ').match(/kb-b-s\d{2}-c\d+/g) ?? []);
            return JSON.stringify({ type: 'final', answer: ref.answer, source_ids: ref.source_ids.filter((id) => shown.has(id)), unresolved: ref.unresolved ?? '' });
          },
        ]);
      },
      close: async () => { await fake.close(); await rm(dir, { recursive: true, force: true }); },
    };
  } catch (err) {
    await fake.close();
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
}
