// READ tool: exact arithmetic on numbers the model copied from knowledge-base chunks.
//
// Why it exists: a small local LLM states the right facts ("600,000 VND, 10% off") but often gets the
// arithmetic wrong (a real run answered 510,000). The model supplies the expression, the backend computes it.
// This is NOT eval: a tiny recursive-descent parser over numbers, + - * / and parentheses, using exact
// rational numbers (BigInt), so 600000 * 0.9 is exactly 540000 with no floating-point error.
// The tool checks arithmetic only; it cannot know whether the inputs were really in the KB.

import { extractAmounts } from '../rag/amounts.js';

export const MAX_EXPRESSION_CHARS = 120;
const PERCENT = /(\d+(?:\.\d+)?)\s*%/g;
const MAX_NUMBER_DIGITS = 15;
const MAX_OPERATIONS = 24;
const MAX_ABSOLUTE = 10n ** 15n;
const RESULT_DECIMALS = 4;

const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a || 1n; };
const rational = (n, d = 1n) => { if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d); return { n: n / g, d: d / g }; };
const add = (x, y) => rational(x.n * y.d + y.n * x.d, x.d * y.d);
const sub = (x, y) => rational(x.n * y.d - y.n * x.d, x.d * y.d);
const mul = (x, y) => rational(x.n * y.n, x.d * y.d);

export class CalculateError extends Error {}

/** "600,000" -> 600000 only for proper thousands groups; "1,5" and "1,2345" are rejected as ambiguous. */
function parseNumber(text) {
  let t = text;
  if (t.includes(',')) {
    if (!/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) throw new CalculateError(`"${text}" is ambiguous: write 600000 or 600,000 with a dot for decimals (0.9).`);
    t = t.replaceAll(',', '');
  }
  const [whole, fraction = ''] = t.split('.');
  if ((whole + fraction).replace(/^0+/, '').length > MAX_NUMBER_DIGITS) throw new CalculateError(`"${text}" has too many digits.`);
  return rational(BigInt((whole || '0') + fraction), 10n ** BigInt(fraction.length));
}

function tokenize(source) {
  const text = String(source).replaceAll('×', '*').replaceAll('÷', '/');
  if (!text.trim()) throw new CalculateError('The expression is empty.');
  if (text.length > MAX_EXPRESSION_CHARS) throw new CalculateError(`The expression is longer than ${MAX_EXPRESSION_CHARS} characters.`);
  const tokens = [];
  const re = /\s+|(\d+(?:,\d+)+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)|([-+*/()])|(.)/gy;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[1] !== undefined) tokens.push({ type: 'num', value: m[1] });
    else if (m[2] !== undefined) tokens.push({ type: 'op', value: m[2] });
    else if (m[3] !== undefined) throw new CalculateError(`Unsupported character "${m[3]}". Use only numbers, + - * / and parentheses; write 10% as 0.1 or 10 / 100.`);
  }
  return tokens;
}

/** Exact rational value of an arithmetic expression. Throws CalculateError for anything else. */
export function evaluate(source) {
  const tokens = tokenize(source);
  let position = 0, operations = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++];
  const op = (value) => peek()?.type === 'op' && peek().value === value;
  const count = () => { if (++operations > MAX_OPERATIONS) throw new CalculateError(`More than ${MAX_OPERATIONS} operations.`); };

  function primary() {
    const t = take();
    if (!t) throw new CalculateError('The expression ends unexpectedly.');
    if (t.type === 'num') return parseNumber(t.value);
    if (t.value === '(') {
      const inner = expression();
      if (!op(')')) throw new CalculateError('Missing closing parenthesis.');
      take();
      return inner;
    }
    throw new CalculateError(`Unexpected "${t.value}".`);
  }
  function unary() {
    if (op('-')) { take(); count(); const v = unary(); return rational(-v.n, v.d); }
    if (op('+')) { take(); return unary(); }
    return primary();
  }
  function term() {
    let value = unary();
    while (op('*') || op('/')) {
      const operator = take().value; count();
      const right = unary();
      if (operator === '*') value = mul(value, right);
      else { if (right.n === 0n) throw new CalculateError('Division by zero.'); value = rational(value.n * right.d, value.d * right.n); }
      if ((value.n < 0n ? -value.n : value.n) > MAX_ABSOLUTE * value.d) throw new CalculateError('The result is too large.');
    }
    return value;
  }
  function expression() {
    let value = term();
    while (op('+') || op('-')) { const operator = take().value; count(); const right = term(); value = operator === '+' ? add(value, right) : sub(value, right); }
    return value;
  }

  const value = expression();
  if (position < tokens.length) throw new CalculateError(`Unexpected "${tokens[position].value}".`);
  if ((value.n < 0n ? -value.n : value.n) > MAX_ABSOLUTE * value.d) throw new CalculateError('The result is too large.');
  return value;
}

/** Decimal text with at most 4 decimals (half away from zero); trailing zeros removed. */
export function formatRational({ n, d }) {
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const scale = 10n ** BigInt(RESULT_DECIMALS);
  let scaled = (abs * scale * 2n + d) / (2n * d); // round half up
  const exact = (abs * scale) % d === 0n;
  const whole = scaled / scale, fraction = String(scaled % scale).padStart(RESULT_DECIMALS, '0').replace(/0+$/, '');
  return { text: `${negative && scaled !== 0n ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`, rounded: !exact };
}

const withThousands = (text) => text.replace(/^(-?)(\d+)/, (_, sign, whole) => sign + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ','));

export const calculate = {
  name: 'calculate',
  access: 'read',
  requiresApproval: false,
  description:
    'Exact arithmetic for prices and discounts. Pass ONE expression using numbers copied from the knowledge-base chunks and + - * / ( ), '
    + 'for example "100000 - 100000 * 10 / 100" (10% off 100,000 gives 90000). Write a percentage as a fraction (10 / 100 or 0.1), never with %. '
    + 'Use it for every calculation instead of computing in your head, and answer with the returned result. '
    + 'It checks arithmetic only: it cannot tell whether your input numbers really come from the chunks.',
  schema: {
    type: 'object',
    properties: { expression: { type: 'string', minLength: 1, maxLength: MAX_EXPRESSION_CHARS } },
    required: ['expression'],
    additionalProperties: false,
  },

  checkRules(args) {
    try { evaluate(args.expression); return []; } catch (err) { if (err instanceof CalculateError) return [err.message]; throw err; }
  },

  async execute(args) {
    const value = evaluate(args.expression);
    const { text, rounded } = formatRational(value);
    return { expression: args.expression.trim(), result: text, result_formatted: withThousands(text), rounded_to_4_decimals: rounded, note: 'Arithmetic only; the inputs are not verified against the knowledge base.' };
  },

  summarize(result) { return `${result.expression} = ${result.result}`; },

  /** What the run remembers of each successful calculation (kept in run.calculations, at most 12). */
  captureCalculation(args, result) { return { expression: result.expression, result: result.result }; },

  /**
   * Numeric grounding: every money amount in the final answer must be quoted from a chunk the model was shown,
   * or be a calculate result of THIS run, or be a backend-computed hint (below). This stops invented prices and
   * keeps derived amounts (discounts) out of the model's head.
   *
   * When an amount is refused, the backend does the arithmetic itself on the numbers the answer already
   * mentions and that really appear in the chunks (an amount and a percentage), puts the exact results in
   * the repair message and remembers them in run.calculations (via: 'hint'). The model only has to copy one.
   */
  checkFinal(decision, run) {
    if (decision.type !== 'final') return [];
    const chunkAmounts = new Set(), chunkPercents = new Set();
    for (const call of run.retrieval ?? []) for (const item of call.items) {
      for (const a of extractAmounts(item.text)) chunkAmounts.add(a.value);
      for (const m of item.text.matchAll(PERCENT)) chunkPercents.add(m[1]);
    }
    const known = new Set(chunkAmounts);
    for (const c of run.calculations ?? []) { const v = Number(c.result); if (Number.isFinite(v)) known.add(Math.round(v)); }
    const mentioned = extractAmounts(decision.answer).filter((a) => a.money);
    const unknown = [...new Set(mentioned.filter((a) => !known.has(a.value)).map((a) => a.value))];
    if (!unknown.length) return [];

    // Operands the model itself used and that are really in the chunks: amounts and percentages.
    const operands = [...new Set(mentioned.filter((a) => chunkAmounts.has(a.value)).map((a) => a.value))].slice(0, 3);
    const percents = [...new Set([...String(decision.answer).matchAll(PERCENT)].map((m) => m[1]).filter((p) => chunkPercents.has(p)))].slice(0, 3);
    const hints = [];
    for (const amount of operands) for (const percent of percents) {
      const expression = `${amount} - ${amount} * ${percent} / 100`;
      hints.push({ expression, result: formatRational(evaluate(expression)).text, text: `${amount.toLocaleString('en-US')} less ${percent}% = ${withThousands(formatRational(evaluate(expression)).text)}` });
    }
    run.calculations ??= [];
    for (const h of hints) {
      if (run.calculations.length < 12 && !run.calculations.some((c) => c.expression === h.expression)) run.calculations.push({ step: run.steps_used, expression: h.expression, result: h.result, via: 'hint' });
    }
    const advice = hints.length
      ? `Exact arithmetic on numbers from your own answer: ${hints.map((h) => h.text).join('; ')}. If one of these is the amount to pay, answer with that exact amount. Otherwise call calculate.`
      : 'Compute any derived amount (a discount, a total) with calculate, for example "600000 - 600000 * 10 / 100", and answer with its result.';
    return [`The amount(s) ${unknown.map((v) => v.toLocaleString('en-US')).join(', ')} in your answer are neither quoted in the retrieved chunks nor computed by the backend. ${advice} Do not state amounts you did not get from the chunks or from calculate.`];
  },
};
