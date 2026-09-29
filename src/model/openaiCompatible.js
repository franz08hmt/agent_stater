// The one real provider path: POST {baseUrl}/chat/completions.
// Works with Gemini's OpenAI-compatibility endpoint, Ollama (/v1), vLLM and OpenAI,
// so switching provider is a .env change, not a code change.
// Docs checked: ai.google.dev/gemini-api/docs/openai, docs.ollama.com/api/openai-compatibility

export class ModelError extends Error {
  /** @param {'unavailable'|'timeout'|'bad_request'|'bad_response'} kind */
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export function createOpenAICompatibleModel(cfg) {
  const base = cfg.baseUrl.endsWith('/') ? cfg.baseUrl : `${cfg.baseUrl}/`;
  const url = new URL('chat/completions', base);

  async function once(messages, signal) {
    const body = {
      model: cfg.name,
      messages,
      temperature: cfg.temperature,
      max_tokens: cfg.maxOutputTokens,
    };
    if (cfg.jsonMode) body.response_format = { type: 'json_object' };
    if (cfg.reasoningEffort) body.reasoning_effort = cfg.reasoningEffort;

    const headers = { 'content-type': 'application/json' };
    if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;

    let res;
    try {
      res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    } catch (err) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') throw new ModelError('timeout', 'Model call timed out or was cancelled.');
      throw new ModelError('unavailable', `Model endpoint unreachable (${err.cause?.code || err.cause?.message || err.message}).`);
    }
    if (!res.ok) {
      // Keep a short excerpt for diagnosis; the request (and its key) is never echoed.
      const excerpt = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 240);
      const kind = RETRYABLE.has(res.status) ? 'unavailable' : 'bad_request';
      throw Object.assign(new ModelError(kind, `Model endpoint returned HTTP ${res.status}: ${excerpt}`), { status: res.status });
    }
    const data = await res.json().catch(() => null);
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new ModelError('bad_response', 'Model response had no message content.');
    return { text, usage: data.usage || null };
  }

  return {
    provider: 'openai-compatible',
    name: cfg.name,
    isMock: false,
    /** One bounded retry for rate limits / 5xx / network errors; never for timeouts or 4xx. */
    async complete({ messages, signal }) {
      try {
        return await once(messages, signal);
      } catch (err) {
        if (err.kind !== 'unavailable' || signal?.aborted) throw err;
        await new Promise((r) => setTimeout(r, 800));
        return once(messages, signal);
      }
    },
  };
}
