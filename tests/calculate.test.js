import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, evaluate, formatRational, CalculateError, MAX_EXPRESSION_CHARS } from '../src/tools/calculate.js';
import { validate } from '../src/tools/schema.js';
import { createConfiguredToolRegistry, BUILTIN_TOOLS } from '../src/tools/registry.js';
import { sunriseFixture, call, final } from './rag-helpers.js';

const run = async (expression) => calculate.execute({ expression });
const result = async (expression) => (await run(expression)).result;

test('exact arithmetic: the discount that a real model got wrong (510,000) is computed exactly', async () => {
  assert.equal(await result('600000 - 600000 * 10 / 100'), '540000');
  assert.equal(await result('600,000 * 0.9'), '540000');
  assert.equal(await result('250000 * (100 - 20) / 100'), '200000');
  assert.equal(await result('500000 - 500000 * 10 / 100'), '450000');
  assert.equal((await run('600000 * 0.9')).result_formatted, '540,000');
});

test('no floating-point error: decimals are exact rationals', async () => {
  assert.equal(await result('0.1 + 0.2'), '0.3');
  assert.equal(await result('0.7 * 3'), '2.1');
  assert.equal(await result('1.15 * 100'), '115');
  assert.equal(await result('600000 * 0.35'), '210000');
});

test('precedence, parentheses, unary signs and the unicode operators', async () => {
  assert.equal(await result('2 + 3 * 4'), '14');
  assert.equal(await result('(2 + 3) * 4'), '20');
  assert.equal(await result('-5.25 + 1'), '-4.25');
  assert.equal(await result('10 - -2'), '12');
  assert.equal(await result('600000 × 0.9'), '540000');
  assert.equal(await result('100 ÷ 8'), '12.5');
});

test('non-terminating results are rounded to 4 decimals and flagged', async () => {
  const r = await run('100 / 3');
  assert.deepEqual([r.result, r.rounded_to_4_decimals], ['33.3333', true]);
  assert.deepEqual([(await run('2 / 3')).result, (await run('1 / 8')).result], ['0.6667', '0.125']);
  assert.equal((await run('1 / 8')).rounded_to_4_decimals, false);
  assert.equal(formatRational({ n: -1n, d: 3n }).text, '-0.3333');
});

test('it is not eval: code, identifiers, exponents, percent signs and exponents notation are all rejected', async () => {
  for (const bad of ['process.exit()', 'require("fs")', 'globalThis', '2 ** 3', '10%', '600000 - 10%', '1e9', '0x10', '`1`', 'Math.max(1,2)', '1; 2', '1 // 2', 'a + 1']) {
    await assert.rejects(run(bad), CalculateError, bad);
    assert.equal(calculate.checkRules({ expression: bad }).length, 1, `checkRules reports ${bad}`);
  }
});

test('malformed input gets an explanation the model can repair from', async () => {
  assert.deepEqual(calculate.checkRules({ expression: '10 / 0' }), ['Division by zero.']);
  assert.match(calculate.checkRules({ expression: '(1 + 2' })[0], /closing parenthesis/);
  assert.match(calculate.checkRules({ expression: '1 +' })[0], /ends unexpectedly/);
  assert.match(calculate.checkRules({ expression: '1,5 * 2' })[0], /ambiguous/);
  assert.match(calculate.checkRules({ expression: '6 % 4' })[0], /Unsupported character "%"/);
  assert.deepEqual(calculate.checkRules({ expression: '600,000 * 0.9' }), [], 'proper thousands separators are accepted');
});

test('bounds: length, digits, operation count and magnitude', async () => {
  await assert.rejects(run('1' + '+1'.repeat(MAX_EXPRESSION_CHARS)), CalculateError);
  await assert.rejects(run('1'.repeat(16)), /too many digits/);
  await assert.rejects(run(Array(30).fill('1').join('+')), /operations/);
  await assert.rejects(run('999999999999999 * 999999999999999'), /too large/);
  assert.deepEqual(validate(calculate.schema, { expression: '1 + 1', extra: 1 }).length > 0, true, 'no extra arguments');
  assert.ok(validate(calculate.schema, { expression: 'x'.repeat(MAX_EXPRESSION_CHARS + 1) }).length > 0);
  assert.ok(validate(calculate.schema, {}).length > 0);
});

test('declaration: a pure read tool that never needs approval, and an honest description', () => {
  assert.equal(calculate.access, 'read');
  assert.equal(calculate.requiresApproval, false);
  assert.match(calculate.description, /cannot tell whether your input numbers really come from the chunks/);
  assert.ok(Object.hasOwn(BUILTIN_TOOLS, 'calculate'));
  assert.equal(createConfiguredToolRegistry(['search_kb', 'calculate']).describe().length, 2);
});

// ── end to end through the real runner: search, calculate, answer ───────────────────────────────────────
test('agent flow: search_kb, then calculate, then a final answer with the exact result and grounded sources', async (t) => {
  const f = await sunriseFixture(t, { replies: [
    call('Sunrise Plus member cardiology consultation fee'),
    JSON.stringify({ type: 'tool_call', tool: 'calculate', arguments: { expression: '600000 - 600000 * 10 / 100' } }),
    final('A Sunrise Plus member pays 540,000 VND: 600,000 VND less 10%.', ['kb-b-s04-c1', 'kb-b-s08-c1']),
  ] });
  const run = await f.ask('A Sunrise Plus member has a cardiology consultation. How much do they pay?');
  assert.equal(run.status, 'completed', JSON.stringify(run.failure));
  const tools = run.trace.filter((x) => x.kind === 'tool');
  assert.deepEqual(tools.map((x) => [x.tool_name, x.status]), [['search_kb', 'ok'], ['calculate', 'ok']]);
  assert.equal(tools[1].summary, '600000 - 600000 * 10 / 100 = 540000');
  assert.match(run.final.answer, /540,000/);
  assert.equal(run.metrics.embeddings.requests, 1, 'calculate sends no embedding request');
  assert.equal(f.fake.embedHits().length - 1, 1, 'one query embedding reached the endpoint (the other hit is the index build)');
});

test('agent flow: a bad expression is a repairable tool error, not a crash, and the run can still finish', async (t) => {
  const f = await sunriseFixture(t, { replies: [
    call('cardiology fee'),
    JSON.stringify({ type: 'tool_call', tool: 'calculate', arguments: { expression: '600000 - 10%' } }),
    JSON.stringify({ type: 'tool_call', tool: 'calculate', arguments: { expression: '600000 - 600000 * 10 / 100' } }),
    final('540,000 VND.', ['kb-b-s04-c1']),
  ] });
  const run = await f.ask('How much does a Sunrise Plus member pay for cardiology?');
  assert.equal(run.status, 'completed', JSON.stringify(run.failure));
  assert.ok(run.trace.some((x) => x.tool_name === 'calculate' && x.status !== 'ok' && /Unsupported character/.test(x.summary ?? '')), 'the model was told what was wrong');
  assert.equal(run.trace.filter((x) => x.kind === 'tool' && x.tool_name === 'calculate' && x.status === 'ok').length, 1);
  assert.equal(run.trace.filter((x) => x.kind === 'tool' && x.tool_name === 'calculate' && x.status === 'rejected').length, 1, 'the bad expression was rejected before it ran');
});

test('the calculator does not let a final answer skip retrieval or cite unseen chunks', async (t) => {
  const f = await sunriseFixture(t, { replies: [
    JSON.stringify({ type: 'tool_call', tool: 'calculate', arguments: { expression: '600000 * 0.9' } }),
    final('540,000 VND.', ['kb-b-s04-c1']),
    final('540,000 VND.', ['kb-b-s04-c1']),
    final('540,000 VND.', ['kb-b-s04-c1']),
  ] });
  const run = await f.ask('How much does a Sunrise Plus member pay for cardiology?');
  assert.notEqual(run.status, 'completed', 'a final without any search_kb is refused');
  assert.equal(run.final, null);
});

test('a legacy notes task cannot enable calculate (it is for vector knowledge-base tasks only)', async () => {
  const { loadTaskConfig } = await import('../config/task.config.js');
  const { readFile, writeFile, mkdtemp, cp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { ROOT } = await import('./helpers.js');
  const dir = await mkdtemp(join(tmpdir(), 'calc-legacy-'));
  try {
    for (const folder of ['config', 'data']) await cp(join(ROOT, folder), join(dir, folder), { recursive: true });
    const file = join(dir, 'config', 'task.json');
    const raw = JSON.parse(await readFile(file, 'utf8'));
    await writeFile(file, JSON.stringify({ ...raw, allowed_tools: [...raw.allowed_tools, 'calculate'] }));
    await assert.rejects(loadTaskConfig({ root: dir, file }), /calculate is only available to vector-retrieval/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// ── numeric grounding: amounts must be quoted from chunks or computed ───────────────────────────────────
const runWith = (chunkText, calculations = []) => ({ retrieval: [{ items: [{ text: chunkText }] }], calculations });
const finalOf = (answer) => ({ type: 'final', answer, source_ids: [], unresolved: '' });

test('numeric grounding: amounts quoted from a shown chunk pass; unknown amounts are refused with a way forward', () => {
  const run = runWith('Cardiology consultation | 600,000 VND\nSunrise Plus members get 10% off in-person consultations.');
  assert.deepEqual(calculate.checkFinal(finalOf('The fee is 600,000 VND.'), run), []);
  const refused = calculate.checkFinal(finalOf('A member pays 540,000 VND.'), run);
  assert.equal(refused.length, 1);
  assert.match(refused[0], /540,000/);
  assert.match(refused[0], /calculate/);
  assert.match(refused[0], /600000 - 600000 \* 10 \/ 100/, 'the message shows the model how to call it');
});

test('numeric grounding: a calculate result in THIS run makes the amount legitimate (also in Vietnamese notation)', () => {
  const run = runWith('Cardiology 600,000 VND', [{ expression: '600000 - 600000 * 10 / 100', result: '540000' }]);
  assert.deepEqual(calculate.checkFinal(finalOf('A member pays 540,000 VND.'), run), []);
  assert.deepEqual(calculate.checkFinal(finalOf('Thành viên trả 540.000 VND.'), run), []);
  assert.deepEqual(calculate.checkFinal(finalOf('Khoảng 540k.'), run), []);
  assert.equal(calculate.checkFinal(finalOf('A member pays 510,000 VND.'), run).length, 1, 'a different number is still refused');
});

test('numeric grounding: invented amounts, such as a back-computed "standard fee", are refused', () => {
  const run = runWith('Cardiology 600,000 VND');
  const refused = calculate.checkFinal(finalOf('This is 10% off the standard fee of 666,666.67 VND.'), run);
  assert.equal(refused.length, 1);
  assert.match(refused[0], /666,666/);
});

test('numeric grounding ignores things that are not prices: dates, percentages, hours, times, counts, tool calls', () => {
  const run = runWith('Updates effective 1 October 2026');
  assert.deepEqual(calculate.checkFinal(finalOf('Open 8:00 to 12:00 on Sunday; results in 48 hours; 20% off for children under 6; effective 1 October 2026 at 25 Le Loi Street.'), run), []);
  assert.deepEqual(calculate.checkFinal({ type: 'tool_call', tool: 'calculate', arguments: { expression: '1 + 1' } }, run), []);
  assert.deepEqual(calculate.checkFinal(finalOf('The guide does not provide that.'), { }), [], 'a run with no evidence yet is fine for a no-number answer');
});

test('agent flow: a mental-arithmetic final is refused, the model repairs with calculate, and the exact amount is accepted', async (t) => {
  const f = await sunriseFixture(t, { replies: [
    call('Sunrise Plus member cardiology consultation fee'),
    final('A Sunrise Plus member pays 510,000 VND.', ['kb-b-s04-c1', 'kb-b-s08-c1']),
    JSON.stringify({ type: 'tool_call', tool: 'calculate', arguments: { expression: '600000 - 600000 * 10 / 100' } }),
    final('A Sunrise Plus member pays 540,000 VND (600,000 VND less 10%).', ['kb-b-s04-c1', 'kb-b-s08-c1']),
  ] });
  const run = await f.ask('A Sunrise Plus member has a cardiology consultation. How much do they pay?');
  assert.equal(run.status, 'completed', JSON.stringify(run.failure));
  assert.ok(run.trace.some((x) => x.kind === 'decision' && x.status === 'invalid' && /510,000/.test(x.summary) && /calculate/.test(x.summary)), 'the wrong final was refused with an explanation');
  assert.equal(run.repairs_used, 1);
  assert.deepEqual(run.calculations.map((c) => [c.expression, c.result]), [['600000 - 600000 * 10 / 100', '540000']]);
  assert.match(run.final.answer, /540,000/);
});

test('agent flow: a model that keeps stating an unsourced amount ends in invalid_model_output, never in a wrong accepted answer', async (t) => {
  const bad = final('A Sunrise Plus member pays 510,000 VND.', ['kb-b-s04-c1']);
  const f = await sunriseFixture(t, { replies: [call('cardiology fee'), bad, bad, bad, bad] });
  const run = await f.ask('How much does a Sunrise Plus member pay for cardiology?');
  assert.equal(run.status, 'failed');
  assert.equal(run.failure.code, 'invalid_model_output');
  assert.equal(run.final, null);
});

test('agent flow: amounts that are quoted from the chunks need no calculation (no extra step for plain lookups)', async (t) => {
  const f = await sunriseFixture(t, { replies: [call('dermatology consultation fee'), final('The dermatology fee is 500,000 VND since 1 October 2026 (it was 450,000 VND).', ['kb-b-s10-c1', 'kb-b-s04-c1'])] });
  const run = await f.ask('What is the current dermatology consultation fee?');
  assert.equal(run.status, 'completed', JSON.stringify(run.failure));
  assert.equal(run.trace.filter((x) => x.kind === 'tool').length, 1, 'only search_kb ran');
});

// ── backend-computed hints: the model copies an exact number instead of calculating in its head ──────────
const DISCOUNT_CHUNK = 'Cardiology consultation (District 1 branch only) | 600,000 VND\nSunrise Plus members get 10% off all in-person consultations. Children under 6 years old get 20% off general consultations.';

test('hints: a refused amount comes with exact arithmetic on the amounts and percentages the answer itself used', () => {
  const run = runWith(DISCOUNT_CHUNK);
  const refused = calculate.checkFinal(finalOf('A member pays 600,000 VND; the 10% discount applies to the standard fee of 666,666.67 VND.'), run);
  assert.equal(refused.length, 1);
  assert.match(refused[0], /600,000 less 10% = 540,000/);
  assert.doesNotMatch(refused[0], /20%/, 'a percentage the answer did not mention is not offered');
  assert.deepEqual(run.calculations.map((c) => [c.expression, c.result, c.via]), [['600000 - 600000 * 10 / 100', '540000', 'hint']]);
  // the hinted amount is now legitimate, an unrelated one is still refused
  assert.deepEqual(calculate.checkFinal(finalOf('A Sunrise Plus member pays 540,000 VND.'), run), []);
  assert.equal(calculate.checkFinal(finalOf('A Sunrise Plus member pays 510,000 VND.'), run).length, 1);
});

test('hints use only numbers that really appear in the chunks (an invented percentage or amount is never an operand)', () => {
  const run = runWith(DISCOUNT_CHUNK);
  const refused = calculate.checkFinal(finalOf('About 700,000 VND less 35% is 455,000 VND.'), run);
  assert.equal(refused.length, 1);
  assert.doesNotMatch(refused[0], /less \d+% =/, 'no hint: 700,000 and 35% are not in the chunks');
  assert.match(refused[0], /calculate/, 'falls back to telling the model how to call the calculator');
  assert.deepEqual(run.calculations, []);
});

test('agent flow: a wrong mental-arithmetic final gets the exact amount in the repair message and the corrected answer is accepted', async (t) => {
  const f = await sunriseFixture(t, { replies: [
    call('Sunrise Plus member cardiology consultation fee'),
    final('A Sunrise Plus member pays 510,000 VND for cardiology: 600,000 VND less the 10% member discount.', ['kb-b-s04-c1', 'kb-b-s08-c1']),
    final('A Sunrise Plus member pays 540,000 VND for cardiology: 600,000 VND less the 10% member discount.', ['kb-b-s04-c1', 'kb-b-s08-c1']),
  ] });
  const run = await f.ask('A Sunrise Plus member has a cardiology consultation. How much do they pay?');
  assert.equal(run.status, 'completed', JSON.stringify(run.failure));
  assert.equal(run.repairs_used, 1);
  const refusal = run.trace.find((x) => x.kind === 'decision' && x.status === 'invalid');
  assert.match(refusal.summary, /510,000/);
  assert.match(refusal.summary, /600,000 less 10% = 540,000/);
  assert.match(run.final.answer, /540,000/);
  assert.equal(run.calculations[0].via, 'hint');
});
