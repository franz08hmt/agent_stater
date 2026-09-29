// Keyword retrieval with BM25 scoring over paragraphs.
// This is lexical search: it matches words, not meaning. It is NOT vector search
// and uses no embeddings. A question phrased with different words than the notes
// will miss — that is a known, documented limitation of this starter.
//
// Retriever interface (keep it this small so an embedding retriever can replace it):
//   search(query, { limit }) -> Promise<Passage[]>
//   has(sourceId)            -> boolean
// Passage = { source_id, title, passage, text, score }

import { readdir, readFile } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';

// Removing accents makes different Vietnamese words collide ("đề" exam / "để" so that,
// "mã" code / "mà", "đăng" / "đang", "thi" exam / "thì"). Only words that are almost
// never the point of a search are listed, so meaningful terms are not dropped.
const STOPWORDS = new Set([
  'la', 'va', 'cua', 'cho', 'cac', 'mot', 'nhung', 'duoc', 'khi', 'nay', 'voi', 'trong',
  'the', 'nao', 'gi', 'neu', 'nhu', 'cung', 'khong', 'da', 'se', 'vao', 'theo',
  'is', 'are', 'of', 'to', 'and', 'or', 'in', 'on', 'for', 'what', 'how', 'with',
]);

/** Lowercase, strip Vietnamese accents (so "bảo mật" matches "bao mat"), split on non-letters. */
export function tokenize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/** Parse one markdown note: "# Title", ">" banner lines are metadata, blank-line paragraphs are passages. */
function parseNote(sourceId, raw) {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const title = (lines.find((l) => l.startsWith('# ')) || `# ${sourceId}`).slice(2).trim();
  const body = lines.filter((l) => !l.startsWith('# ') && !l.startsWith('>')).join('\n');
  const passages = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return { sourceId, title, passages };
}

export async function createKeywordRetriever({ dir }) {
  const files = (await readdir(dir)).filter((f) => extname(f) === '.md').sort();
  const docs = [];
  for (const f of files) docs.push(parseNote(basename(f, '.md'), await readFile(join(dir, f), 'utf8')));
  return createRetrieverFromDocs(docs);
}

/** Exposed separately so tests can build a retriever from in-memory documents. */
export function createRetrieverFromDocs(docs) {
  const index = [];
  for (const d of docs) {
    d.passages.forEach((text, i) => {
      const tokens = tokenize(`${d.title} ${text}`);
      const tf = new Map();
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
      index.push({ source_id: d.sourceId, title: d.title, passage: i + 1, text, tf, len: tokens.length });
    });
  }
  const N = index.length;
  const avgLen = index.reduce((s, p) => s + p.len, 0) / Math.max(1, N);
  const df = new Map();
  for (const p of index) for (const t of p.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const ids = new Set(docs.map((d) => d.sourceId));
  const k1 = 1.2, b = 0.75;

  return {
    kind: 'keyword-bm25',
    has: (sourceId) => ids.has(sourceId),
    async search(query, { limit = 3 } = {}) {
      const terms = [...new Set(tokenize(query))];
      const scored = index.map((p) => {
        let score = 0;
        for (const t of terms) {
          const f = p.tf.get(t);
          if (!f) continue;
          const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5));
          score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * p.len) / avgLen)));
        }
        return { p, score };
      });
      return scored
        .filter((s) => s.score > 0)
        .sort((a, b2) => b2.score - a.score)
        .slice(0, limit)
        .map(({ p, score }) => ({
          source_id: p.source_id, title: p.title, passage: p.passage,
          text: p.text.length > 600 ? `${p.text.slice(0, 600)}…` : p.text,
          score: Math.round(score * 100) / 100,
        }));
    },
  };
}
