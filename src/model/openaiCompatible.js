// The one real provider path: POST {baseUrl}/chat/completions.
// Works with Gemini's OpenAI-compatibility endpoint, Ollama (/v1), vLLM and OpenAI,
// so switching provider is a .env change, not a code change.
// Docs checked: ai.google.dev/gemini-api/docs/openai, docs.ollama.com/api/openai-compatibility

import { setTimeout as delay } from 'node:timers/promises';

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

function safeDiagnostic(text, messages, apiKey) {
  if (apiKey) text = text.split(apiKey).join('[redacted]');
  // An error endpoint may echo its request; scrub conversation before truncating.
  for (const { content } of messages) {
    if (!content) continue;
    for (const value of [content, JSON.stringify(content).slice(1, -1)]) text = text.split(value.replace(/\s+/g, ' ')).join('[redacted request]');
  }
  return text;
}

export function createOpenAICompatibleModel(cfg) {
  const base = cfg.baseUrl.endsWith('/') ? cfg.baseUrl : `${cfg.baseUrl}/`;
  const url = new URL('chat/completions', base);

  async function once(messages, signal, requestControl, retry = false) {
    if (signal?.aborted) throw new ModelError('timeout', 'Model call timed out or was cancelled.');
    const plan = requestControl?.beforeRequest(messages, cfg.maxOutputTokens);
    const body = {
      model: cfg.name,
      messages,
      temperature: cfg.temperature,
      max_tokens: plan?.output ?? cfg.maxOutputTokens,
    };
    if (cfg.jsonMode) body.response_format = { type: 'json_object' };
    if (cfg.reasoningEffort) body.reasoning_effort = cfg.reasoningEffort;

    const headers = { 'content-type': 'application/json' };
    if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;

    const serialized = JSON.stringify(body);
    let res, usage = null;
    const started = Date.now();
    // No await between the final gate and fetch: every attempt, including a retry,
    // starts exactly one reservation and is persisted while the HTTP request is in flight.
    const pending = fetch(url, { method: 'POST', headers, body: serialized, signal }).catch((err) => {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') throw new ModelError('timeout', 'Model call timed out or was cancelled.');
      throw new ModelError('unavailable', `Model endpoint unreachable (${err.cause?.code || err.cause?.message || err.message}).`);
    });
    const recorded = requestControl?.requestStarted(plan, retry);
    try {
      [res] = await Promise.all([pending, recorded]);
      if (!res.ok) {
        // Existing short provider diagnostics; never attach the outgoing body/headers.
        const raw = (await res.text().catch(() => '')).replace(/\s+/g, ' ');
        if (signal?.aborted) throw new ModelError('timeout', 'Model call timed out or was cancelled.');
        let diagnostic = raw;
        try {
          const payload = JSON.parse(raw);
          usage = payload?.usage ?? null;
          diagnostic = typeof payload?.error === 'string' ? payload.error
            : typeof payload?.error?.message === 'string' ? payload.error.message : 'Provider error body omitted.';
        } catch { /* plain text provider error */ }
        const excerpt = safeDiagnostic(diagnostic, messages, cfg.apiKey).slice(0, 240);
        let quota = '';
        if (res.status === 429) {
          const id = raw.match(/"quotaId":\s*"([A-Za-z0-9_-]{1,120})"/)?.[1];
          const retryDelay = raw.match(/"retryDelay":\s*"([0-9.]+s)"/)?.[1];
          const parts = [id && `quotaId=${id}`, retryDelay && `retryDelay=${retryDelay}`].filter(Boolean);
          if (parts.length) quota = ` [${safeDiagnostic(parts.join(', '), messages, cfg.apiKey)}]`;
        }
        const kind = res.status === 429 ? 'rate_limited' : RETRYABLE.has(res.status) ? 'unavailable' : 'bad_request';
        throw Object.assign(new ModelError(kind, `Model endpoint returned HTTP ${res.status}${quota}: ${excerpt}`), { status: res.status });
      }
      const data = await res.json().catch(() => null);
      if (signal?.aborted) throw new ModelError('timeout', 'Model call timed out or was cancelled.');
      usage = data?.usage ?? null;
      const text = data?.choices?.[0]?.message?.content;
      if (typeof text !== 'string') throw Object.assign(new ModelError('bad_response', 'Model response had no message content.'), { status: res.status });
      return { text, usage };
    } finally {
      await requestControl?.requestFinished(plan, usage, Date.now() - started);
    }
  }

  return {
    provider: 'openai-compatible',
    name: cfg.name,
    isMock: false,
    maxOutputTokens: cfg.maxOutputTokens,
    runtimeConfig: { ...cfg, provider: 'openai-compatible' }, // backend only; never API metadata
    /** One bounded retry for 5xx / network errors; never for timeouts, 429 or other 4xx. */
    async complete({ messages, signal, requestControl, retry = true }) {
      try {
        return await once(messages, signal, requestControl);
      } catch (err) {
        if (!retry || err.kind !== 'unavailable' || signal?.aborted) throw err;
        try { await delay(800, undefined, { signal }); }
        catch { throw new ModelError('timeout', 'Model call timed out or was cancelled.'); }
        return once(messages, signal, requestControl, true);
      }
    },
  };
}
