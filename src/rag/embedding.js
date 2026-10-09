// Embedding adapter for Ollama's native POST /api/embed (https://docs.ollama.com/api/embed).
//
// This is NOT a chat model: embeddings come from a dedicated embedding model (for example
// embeddinggemma). The endpoint, model and prompt templates are backend configuration, never
// taken from the browser, the task JSON or the LLM. There is no automatic retry: every HTTP
// request is counted by the caller's accounting hook BEFORE it is sent.
//
// Documented behaviour used here:
//   request  { model, input: string | string[], truncate: false, keep_alive? }
//   response { model, embeddings: number[][], total_duration, load_duration, prompt_eval_count }
//   truncate:false makes Ollama return an error instead of silently dropping text that
//   exceeds the model's context window.

export class EmbeddingError extends Error {
  /** @param {'unavailable'|'timeout'|'bad_request'|'bad_response'|'input_too_long'} kind */
  constructor(kind, message, extra = {}) {
    super(message);
    this.kind = kind;
    Object.assign(this, extra);
  }
}

export const MAX_BATCH = 64;
export const MAX_INPUT_CHARS = 8000;
const MAX_RESPONSE_CHARS = 16 * 1024 * 1024;
const MIN_DIMENSION = 8;
const MAX_DIMENSION = 4096;

const sameModel = (expected, actual) => String(actual).replace(/:latest$/, '') === String(expected).replace(/:latest$/, '');

/** Fill "{title}" / "{text}" placeholders. No eval, no other syntax. */
export function applyTemplate(template, values) {
  return template.replace(/\{(title|text)\}/g, (_, key) => values[key] ?? '');
}

/** An embedding must be a finite, non-zero vector of one fixed length. */
export function assertVector(vector, dimension, label = 'embedding') {
  if (!Array.isArray(vector) || vector.length < MIN_DIMENSION || vector.length > MAX_DIMENSION) throw new EmbeddingError('bad_response', `${label} has an invalid dimension.`);
  if (dimension != null && vector.length !== dimension) throw new EmbeddingError('bad_response', `${label} dimension ${vector.length} does not match ${dimension}.`);
  let sum = 0;
  for (const value of vector) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new EmbeddingError('bad_response', `${label} contains a non-finite value.`);
    sum += value * value;
  }
  if (!(Math.sqrt(sum) > 1e-12)) throw new EmbeddingError('bad_response', `${label} has zero norm.`);
}

/** Provider usage is trusted only when it is a non-negative safe integer; otherwise it stays unavailable. */
export function validatePromptEvalCount(value) {
  if (value === undefined || value === null) return { input_tokens: null, present: false, valid: false };
  return Number.isSafeInteger(value) && value >= 0 ? { input_tokens: value, present: true, valid: true } : { input_tokens: null, present: true, valid: false };
}

export function createOllamaEmbedder(profile) {
  const url = new URL(profile.baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('Embedding base_url must be a plain http(s) origin without credentials, path or query.');
  }
  const embedUrl = new URL('/api/embed', url.origin);
  const tagsUrl = new URL('/api/tags', url.origin);
  const timeoutMs = profile.timeoutMs ?? 15000;

  async function call(target, init, { signal }) {
    const combined = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
    let res;
    try {
      res = await fetch(target, { ...init, redirect: 'manual', signal: combined });
    } catch (err) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') throw new EmbeddingError('timeout', `Embedding request timed out or was cancelled (limit ${timeoutMs} ms).`);
      throw new EmbeddingError('unavailable', `Embedding endpoint unreachable (${err.cause?.code || err.cause?.message || err.message}). Is Ollama running?`);
    }
    if (res.status >= 300 && res.status < 400) throw new EmbeddingError('bad_request', `Embedding endpoint answered with a redirect (HTTP ${res.status}); redirects are refused.`);
    const text = await res.text().catch(() => '');
    if (text.length > MAX_RESPONSE_CHARS) throw new EmbeddingError('bad_response', 'Embedding response is too large.');
    if (!res.ok) {
      const excerpt = text.replace(/\s+/g, ' ').slice(0, 200);
      const missing = res.status === 404 ? ` Install it yourself with: ollama pull ${profile.name}` : '';
      throw new EmbeddingError(res.status >= 500 ? 'unavailable' : 'bad_request', `Embedding endpoint returned HTTP ${res.status}: ${excerpt}${missing}`, { status: res.status, modelMissing: res.status === 404 });
    }
    return text;
  }

  return {
    kind: 'ollama-embed',
    profileId: profile.id,
    name: profile.name,
    endpoint: url.origin,
    preprocessing: profile.preprocessingVersion,
    queryText: (query) => applyTemplate(profile.queryTemplate, { text: query }),
    documentText: ({ title, text }) => applyTemplate(profile.documentTemplate, { title, text }),

    /**
     * @param {string[]} texts already prefixed with the model's task prompt
     * @param {{signal?: AbortSignal, accounting?: {before():void, after(r:object):void}, expectedDimension?: number}} options
     * @returns {Promise<{vectors:number[][], usage:object, model:string, ms:number, dimension:number}>}
     */
    async embed(texts, { signal, accounting, expectedDimension } = {}) {
      if (!Array.isArray(texts) || !texts.length || texts.length > MAX_BATCH) throw new EmbeddingError('bad_request', `Embedding input must be 1..${MAX_BATCH} strings.`);
      for (const text of texts) {
        if (typeof text !== 'string' || !text.trim()) throw new EmbeddingError('bad_request', 'Embedding input must be non-empty text.');
        if (text.length > MAX_INPUT_CHARS) throw new EmbeddingError('input_too_long', `Embedding input is ${text.length} characters; the limit is ${MAX_INPUT_CHARS}. Reduce chunk max_chars.`);
      }
      const body = { model: profile.name, input: texts.length === 1 ? texts[0] : texts, truncate: false };
      if (profile.dimensions) body.dimensions = profile.dimensions;
      if (profile.keepAlive) body.keep_alive = profile.keepAlive;
      await accounting?.before(); // counts (and persists) the request, and may refuse it, BEFORE any network I/O
      const started = Date.now();
      let outcome = { ok: false, usage: validatePromptEvalCount(undefined), kind: 'unavailable' };
      try {
        const raw = await call(embedUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, { signal });
        let data;
        try { data = JSON.parse(raw); } catch { throw new EmbeddingError('bad_response', 'Embedding response was not valid JSON.'); }
        if (!data || typeof data !== 'object' || !Array.isArray(data.embeddings)) throw new EmbeddingError('bad_response', 'Embedding response has no "embeddings" array.');
        if (data.embeddings.length !== texts.length) throw new EmbeddingError('bad_response', `Expected ${texts.length} embeddings, received ${data.embeddings.length}.`);
        if (data.model != null && !sameModel(profile.name, data.model)) throw new EmbeddingError('bad_response', `Endpoint answered with model "${data.model}", expected "${profile.name}".`);
        const dimension = expectedDimension ?? data.embeddings[0]?.length;
        data.embeddings.forEach((vector, i) => assertVector(vector, dimension, `embedding ${i + 1}`));
        const usage = validatePromptEvalCount(data.prompt_eval_count);
        outcome = { ok: true, usage, kind: null };
        return { vectors: data.embeddings, usage, model: profile.name, dimension, ms: Date.now() - started };
      } catch (err) {
        outcome = { ok: false, usage: validatePromptEvalCount(undefined), kind: err.kind || 'unavailable' };
        throw err;
      } finally {
        accounting?.after({ ...outcome, ms: Date.now() - started, inputs: texts.length });
      }
    },

    /** Read-only GET /api/tags: is the model installed, and which digest does it have? */
    async inspect({ signal } = {}) {
      const raw = await call(tagsUrl, { method: 'GET' }, { signal });
      let data;
      try { data = JSON.parse(raw); } catch { throw new EmbeddingError('bad_response', 'Tags response was not valid JSON.'); }
      const wanted = profile.name.replace(/:latest$/, '');
      const found = (data.models || []).find((m) => String(m.name).replace(/:latest$/, '') === wanted || String(m.model).replace(/:latest$/, '') === wanted);
      return { installed: Boolean(found), name: found?.name ?? profile.name, digest: found?.digest ?? null, size_bytes: found?.size ?? null };
    },
  };
}
