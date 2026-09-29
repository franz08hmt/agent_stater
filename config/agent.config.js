// Every tunable number lives here. When the exam changes a limit, change it here
// (or in .env) — nothing else in the code hard-codes these values.

function int(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}; got "${raw}".`);
  }
  return n;
}

function num(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${name} must be a number between ${min} and ${max}; got "${raw}".`);
  }
  return n;
}

function bool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be "true" or "false"; got "${raw}".`);
}

/** Build the runtime configuration from process.env. Called once at startup. */
export function loadConfig() {
  const provider = process.env.MODEL_PROVIDER || 'mock';
  if (!['mock', 'openai-compatible'].includes(provider)) {
    throw new Error(`MODEL_PROVIDER must be "mock" or "openai-compatible"; got "${provider}".`);
  }
  return {
    model: {
      provider,
      name: process.env.MODEL_NAME || 'gemini-2.5-flash',
      baseUrl: process.env.MODEL_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/',
      apiKey: process.env.MODEL_API_KEY || '',
      jsonMode: bool('MODEL_JSON_MODE', true),
      reasoningEffort: process.env.MODEL_REASONING_EFFORT || '',
      temperature: num('MODEL_TEMPERATURE', 0, 0, 2),
      maxOutputTokens: int('MODEL_MAX_OUTPUT_TOKENS', 800, 64, 8192),
      timeoutMs: int('MODEL_TIMEOUT_MS', 30000, 1000, 300000),
    },
    limits: {
      maxSteps: int('AGENT_MAX_STEPS', 6, 1, 30),          // tool calls allowed per run
      maxRepairs: int('AGENT_MAX_REPAIRS', 2, 0, 5),       // retries after a malformed model reply
      toolTimeoutMs: int('TOOL_TIMEOUT_MS', 5000, 100, 60000),
      runMaxMs: int('RUN_MAX_MS', 120000, 1000, 1800000),  // active time, excluding approval waits
      maxGoalChars: 500,
      maxObservationChars: 1800,   // one tool result as shown to the model
      maxContextChars: 14000,      // all observations together; oldest are shortened first
      maxAnswerChars: 2000,
      maxModelReplyChars: 8000,
    },
    server: {
      port: int('PORT', 8787, 1, 65535),
      host: process.env.HOST || '127.0.0.1',
      maxBodyBytes: 16 * 1024,
    },
  };
}
