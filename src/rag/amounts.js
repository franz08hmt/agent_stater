// Money-amount parsing shared by the acceptance grader and the runtime numeric-grounding check.
// Numbers are read as numbers (450,000 = 450.000 = 450000 = 450k = 0,45 triệu); a digit is never matched as a substring.

/** Lowercase, strip accents (đ -> d) and collapse whitespace, so Vietnamese and English share word lists. */
export function fold(text) {
  return String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ── amounts ─────────────────────────────────────────────────────────────────────────────────────────────────
const AMOUNT = /(?<![\d.,])(\d{1,3}(?:[.,\u00a0\u202f ]\d{3})+|\d+(?:[.,]\d+)?)(?!\d)\s*(k\b|nghin\b|ngan\b|trieu\b|tr\b|million\b|vnd\b|dong\b)?/g;

/** Amounts in a string (any text; it is folded first). `money` marks tokens we accept as a price. */
export function extractAmounts(text) {
  const folded = fold(text);
  const found = [];
  for (const m of folded.matchAll(AMOUNT)) {
    const raw = m[1], unit = m[2] ?? null;
    const grouped = /^\d{1,3}(?:[.,\u00a0\u202f ]\d{3})+$/.test(raw);
    const number = grouped ? Number(raw.replace(/[^\d]/g, '')) : Number(raw.replace(',', '.'));
    if (!Number.isFinite(number)) continue;
    const factor = unit === 'k' || unit === 'nghin' || unit === 'ngan' ? 1e3 : unit === 'trieu' || unit === 'tr' || unit === 'million' ? 1e6 : 1;
    const value = Math.round(number * factor);
    // A bare small integer (a date, a count, "20%") is not a price; grouped numbers, unit-tagged ones and big bare ones are.
    const money = grouped || unit !== null || value >= 10000;
    found.push({ value, raw: m[0].trim(), money, index: m.index });
  }
  return found;
}
