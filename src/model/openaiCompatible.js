// The one real provider path: POST {baseUrl}/chat/completions.
// Works with Gemini's OpenAI-compatibility endpoint, Ollama (/v1), vLLM and OpenAI,
// so switching provider is a .env change, not a code change.
// Docs checked: ai.google.dev/gemini-api/docs/openai, docs.ollama.com/api/openai-compatibility

export class ModelError extends Error {
  /** @param {'unavailable'|'rate_limited'|'timeout'|'bad_request'|'bad_response'} kind */
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

// 429 is deliberately NOT retried: it means a quota or rate limit was hit, and an immediate
// second request cannot succeed but can still count against a daily quota.
const RETRYABLE = new Set([500, 502, 503, 504]);

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
      // Keep a short excerpt for diagnosis. The request is never echoed, and the key is masked in case
      // a provider repeats it in an error body — this text ends up in the trace and the audit log.
      const raw = (await res.text().catch(() => '')).replace(/\s+/g, ' ');
      let excerpt = cfg.apiKey ? raw.split(cfg.apiKey).join('[redacted]') : raw;
      excerpt = excerpt.slice(0, 240);
      // A 429 body can say WHICH limit was hit (e.g. a per-day quota vs a per-minute one) and when to
      // retry. Surface that up front, before the excerpt is cut: it decides whether to wait or to switch.
      let quota = '';
      if (res.status === 429) {
        const id = raw.match(/"quotaId":\s*"([^"]+)"/)?.[1];
        const delay = raw.match(/"retryDelay":\s*"([^"]+)"/)?.[1];
        const parts = [id && `quotaId=${id}`, delay && `retryDelay=${delay}`].filter(Boolean);
        if (parts.length) quota = ` [${parts.join(', ')}]`;
      }
      const kind = res.status === 429 ? 'rate_limited' : RETRYABLE.has(res.status) ? 'unavailable' : 'bad_request';
      throw Object.assign(new ModelError(kind, `Model endpoint returned HTTP ${res.status}${quota}: ${excerpt}`), { status: res.status });
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
    /** One bounded retry for 5xx / network errors; never for timeouts, 429 or other 4xx. */
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
