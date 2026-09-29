// Scrubs values before they reach the trace or the audit log: secrets by key name,
// long strings shortened. The log records what was done, not everything that was said.

const SECRET_KEY = /(api[_-]?key|token|secret|password|authorization|cookie)/i;

export function redact(value, maxString = 240) {
  if (typeof value === 'string') return value.length > maxString ? `${value.slice(0, maxString)}… (${value.length} chars)` : value;
  if (Array.isArray(value)) return value.map((v) => redact(v, maxString));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? '[redacted]' : redact(v, maxString)]));
  }
  return value;
}
