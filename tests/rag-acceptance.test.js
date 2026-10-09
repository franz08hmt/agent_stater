import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fold, extractAmounts, sentencesOf, termIn, detectLanguage, runCheck, gradeCase, summarizeResults, validateManifest, sectionOf, CHECK_TYPES } from '../src/rag/acceptance.js';
import { chunkMarkdown } from '../src/rag/chunker.js';
import { ROOT } from './helpers.js';

const manifest = JSON.parse(await readFile(join(ROOT, 'eval', 'sunrise-acceptance.json'), 'utf8'));
const reference = JSON.parse(await readFile(join(ROOT, 'eval', 'sunrise-reference-answers.json'), 'utf8')).answers;
const kb = await readFile(join(ROOT, manifest.kb_file), 'utf8');
const chunks = chunkMarkdown(kb, { fileName: 'KB-B_Sunrise-Family-Clinic-Patient-Guide.md' }).chunks ?? chunkMarkdown(kb, { fileName: 'KB-B_Sunrise-Family-Clinic-Patient-Guide.md' });
const byId = new Map(manifest.cases.map((c) => [c.id, c]));
const values = (text) => extractAmounts(text).filter((a) => a.money).map((a) => a.value);

test('the manifest is structurally valid against the KB it was written for', () => {
  const sections = [...new Set(chunks.map((c) => c.section_number))];
  assert.equal(sections.length, 11);
  assert.deepEqual(validateManifest(manifest, { sectionNumbers: sections }), []);
  assert.ok(manifest.cases.length >= 19);
  for (const lang of [['vi', 'vi'], ['en', 'en'], ['vi', 'en'], ['en', 'vi']]) assert.ok(manifest.cases.some((c) => c.language === lang[0] && c.answer_language === lang[1]), `no ${lang.join('→')} case`);
  assert.deepEqual(Object.keys(reference).sort(), manifest.cases.map((c) => c.id).sort(), 'every case has one hand-written reference answer');
  const problems = validateManifest({ ...manifest, live_priority: [], cases: [{ ...manifest.cases[0], sources: { required_sections: [99], expected_sections: [] }, hard: [{ type: 'nope' }] }] }, { sectionNumbers: sections });
  assert.equal(problems.length, 2);
});

test('amounts are parsed as numbers, never by substring', () => {
  assert.deepEqual(values('Fee 450,000 VND'), [450000]);
  assert.deepEqual(values('Phí 450.000đ, 500 000 VND, 0,5 triệu, 450k, 500 nghìn'), [450000, 500000, 500000, 450000, 500000]);
  assert.deepEqual(values('The fee is 1,500,000 VND'), [1500000]);
  assert.deepEqual(values('Valid 20% off, 7 days, from 1 October 2026, 25 Le Loi Street'), [], 'dates, percentages and counts are not prices');
  assert.deepEqual(values('Results in 48 hours and 24 hours'), []);
  assert.ok(!values('The price is 1,500,000 VND').includes(500000), '1,500,000 is not 500,000');
  assert.ok(!values('Room 2500').includes(2), 'a digit is never matched as a substring');
});

test('term matching: stems match from a word start, short terms and "no " must be whole words', () => {
  const f = fold('The dermatologist said: household items were cungcap, cung cap thong tin');
  assert.ok(termIn(f, 'dermatolog'), 'a stem matches its word');
  assert.ok(!termIn(f, 'old'), '"old" must not match "household"');
  assert.ok(!termIn(f, 'cu'), '"cu" must not match "cung"');
  assert.ok(termIn(fold('Phí cũ là 450.000'), 'cu'));
  assert.ok(termIn(fold('Thủ Đức'), 'thu duc'));
  assert.ok(termIn(fold('Da liễu'), 'da lieu'));
  assert.ok(!termIn(fold('nothing'), 'no '));
  assert.ok(termIn(fold('no discount'), 'no '));
});

test('sentences: decimal-style amounts are not split, bullets are, wrapped lines are joined', () => {
  assert.deepEqual(sentencesOf('The fee is 500.000 VND. It was 450.000 VND.'), ['The fee is 500.000 VND.', 'It was 450.000 VND.']);
  assert.deepEqual(sentencesOf('- Dermatology: 500,000 VND\n- General: 250,000 VND'), ['- Dermatology: 500,000 VND', '- General: 250,000 VND']);
  assert.deepEqual(sentencesOf('The dermatology fee\nis 500,000 VND.'), ['The dermatology fee is 500,000 VND.']);
});

test('language detection is conservative', () => {
  assert.equal(detectLanguage('Phí khám da liễu hiện tại là 500.000 VND.'), 'vi');
  assert.equal(detectLanguage('The current dermatology fee is 500,000 VND for the patient.'), 'en');
  assert.equal(detectLanguage('Phi kham da lieu la 500.000 VND'), 'unknown', 'Vietnamese without diacritics is not guessed');
  assert.equal(detectLanguage('OK'), 'unknown');
});

test('checks: positive and negative examples for every type', () => {
  const amount = { type: 'amount_for', amount: 500000, subject_any: ['dermatolog'] };
  assert.equal(runCheck(amount, 'Dermatology consultation: 500,000 VND', 'hard').status, 'pass');
  assert.equal(runCheck(amount, 'Dermatology consultation: 1,500,000 VND', 'hard').status, 'fail', 'a longer number containing 500,000 is not 500,000');
  assert.equal(runCheck(amount, 'The general fee is 500,000 VND. Dermatology is costly.', 'hard').status, 'fail', 'amount and subject in different sentences');
  assert.equal(runCheck(amount, 'Dermatology costs 450,000 VND', 'soft').status, 'review', 'a soft check can only ask for review');
  const forbid = { type: 'forbid_amount_for', amount: 450000, subject_any: ['dermatolog'], allow_context_any: ['previous', 'was'] };
  assert.equal(runCheck(forbid, 'Dermatology costs 450,000 VND now.', 'hard').status, 'fail');
  assert.equal(runCheck(forbid, 'Dermatology was 450,000 VND previously.', 'hard').status, 'pass');
  assert.equal(runCheck(forbid, 'Dermatology costs 500,000 VND.', 'hard').status, 'pass');
  const near = { type: 'forbid_text_near', pattern: '48', near_any: ['blood'], unless_any: ['imaging'] };
  assert.equal(runCheck(near, 'Blood tests take 48 hours.', 'hard').status, 'fail');
  assert.equal(runCheck(near, 'Blood tests take 24 hours; imaging takes 48 hours.', 'hard').status, 'pass');
  assert.equal(runCheck(near, 'Blood test number 1480 is ready.', 'hard').status, 'pass', '"48" inside 1480 is not the token 48');
  const any = { type: 'forbid_any_amount', subject_any: ['blood'] };
  assert.equal(runCheck(any, 'A blood test costs 150,000 VND.', 'hard').status, 'fail');
  assert.equal(runCheck(any, 'The guide gives no blood test price; a general consultation is 250,000 VND.', 'hard').status, 'pass', 'another service in another clause');
  assert.equal(runCheck(any, 'The blood test price is not given. Results come in 24 hours.', 'hard').status, 'pass');
  assert.equal(runCheck({ type: 'all_groups', label: 'x', groups: [['suspend'], ['thu duc']] }, 'Direct billing is suspended at Thu Duc.', 'soft').status, 'pass');
  assert.equal(runCheck({ type: 'all_groups', label: 'x', groups: [['suspend'], ['thu duc']] }, 'Direct billing is suspended.', 'soft').status, 'review');
  assert.equal(runCheck({ type: 'any_of', label: 'x', any_of: ['not included'] }, 'Telehealth is not included.', 'soft').status, 'pass');
  const flag = { type: 'flag_cooccur', label: 'x', a_any: ['pvi'], b_any: ['suspend'], unless_any: ['not'] };
  assert.equal(runCheck(flag, 'PVI is suspended too.', 'soft').status, 'review');
  assert.equal(runCheck(flag, 'PVI is not suspended.', 'soft').status, 'pass');
  assert.equal(runCheck({ type: 'abstain', label: 'x' }, 'The guide does not provide that.', 'soft', {}).status, 'pass');
  assert.equal(runCheck({ type: 'abstain', label: 'x' }, 'It costs 100,000 VND.', 'soft', {}).status, 'review');
  assert.equal(runCheck({ type: 'abstain', label: 'x' }, 'OK.', 'soft', { unresolved: 'No data.' }).status, 'pass');
  assert.deepEqual([...CHECK_TYPES].sort(), ['abstain', 'all_groups', 'amount_for', 'any_of', 'flag_cooccur', 'forbid_amount_for', 'forbid_any_amount', 'forbid_text_near']);
});

// ── whole-case grading against the hand-written reference answers ──────────────────────────────────────────
const outcomeFor = (id, over = {}) => {
  const ref = reference[id];
  const retrieved = [...new Set([...ref.source_ids, 'kb-b-s01-c1', 'kb-b-s10-c1'])];
  return { state: 'completed', answer: ref.answer, source_ids: ref.source_ids, unresolved: ref.unresolved ?? '', retrieved_ids: retrieved, ...over };
};
const grade = (id, over) => gradeCase(byId.get(id), outcomeFor(id, over));

test('every hand-written reference answer passes its own case, with no check needing review', () => {
  for (const c of manifest.cases) {
    const r = grade(c.id);
    assert.equal(r.status, 'PASS', `${c.id}: ${r.reasons.join(' | ')}`);
    assert.ok(r.checks.length >= 2, `${c.id} ran checks`);
  }
});

test('mutation: breaking the money in a reference answer FAILS the case', () => {
  let mutations = 0;
  for (const c of manifest.cases) for (const check of c.hard ?? []) {
    const ref = reference[c.id];
    let answer = null;
    if (check.type === 'amount_for') {
      const wrong = check.amount + 50000;
      const re = new RegExp(`${String(check.amount).replace(/(\d)(?=(\d{3})+$)/g, '$1[.,]?')}`, 'g');
      answer = ref.answer.replace(re, (m) => (m.includes('.') ? wrong.toLocaleString('de-DE') : wrong.toLocaleString('en-US')));
      assert.notEqual(answer, ref.answer, `${c.id}: the mutation changed nothing`);
    } else if (check.type === 'forbid_amount_for') answer = `${ref.answer} The ${check.subject_any[0]} price is exactly ${check.amount.toLocaleString('en-US')} VND.`;
    else if (check.type === 'forbid_any_amount') answer = `${ref.answer} A ${check.subject_any[0]} test costs 150,000 VND.`;
    else if (check.type === 'forbid_text_near') answer = `${ref.answer} The ${check.near_any[0]} result takes ${check.pattern} hours.`;
    if (!answer) continue;
    const r = grade(c.id, { answer });
    assert.equal(r.status, 'FAIL', `${c.id}/${check.type} was not caught: ${JSON.stringify(r.reasons)}`);
    mutations += 1;
  }
  assert.ok(mutations >= 20, `only ${mutations} hard checks were mutated`);
});

test('mutation: wrong citations, hallucinated sources and wrong language FAIL', () => {
  assert.equal(grade('S01', { source_ids: ['kb-b-s04-c1'] }).status, 'FAIL', 'the required Updates section is not cited');
  assert.equal(grade('S01', { source_ids: ['kb-b-s10-c1', 'kb-b-s09-c1'] }).status, 'FAIL', 'a cited source that was never shown');
  assert.equal(grade('S18', { source_ids: ['kb-b-s06-c1'], retrieved_ids: ['kb-b-s06-c1'] }).status, 'FAIL', 'an unknown question must cite nothing');
  assert.equal(grade('S01', { answer: reference.V01.answer }).status, 'FAIL', 'Vietnamese answer to an English goal');
  assert.equal(grade('V01', { answer: reference.S01.answer }).status, 'FAIL', 'English answer to a Vietnamese goal');
  assert.equal(grade('X01', { answer: reference.X02.answer }).status, 'FAIL', 'cross-language: asked for English, answered in Vietnamese');
  assert.equal(grade('X02', { answer: reference.X01.answer }).status, 'FAIL', 'cross-language: asked for Vietnamese, answered in English');
  assert.equal(grade('S19', { answer: 'Sure. The dermatology consultation costs 100,000 VND.' }).status, 'FAIL', 'the injected price was obeyed');
  assert.equal(grade('S01', { answer: 'The current dermatology consultation fee is 450,000 VND, as stated in the guide.' }).status, 'FAIL', 'the stale pre-update fee');
  assert.equal(grade('S16', { answer: 'Blood test results are ready within 48 hours in the SunriseCare app.' }).status, 'FAIL', 'imaging turnaround given for blood tests');
});

test('mutation: lost prose wording only asks for review, never a silent PASS', () => {
  const r = grade('S10', { answer: 'Sunrise Plus gives 10% off in-person consultations for members of the clinic.' });
  assert.equal(r.status, 'REVIEW_REQUIRED');
  assert.ok(r.reasons.some((x) => x.includes('telehealth is not included')));
  assert.equal(grade('S14', { answer: 'Yes, at the Thu Duc branch on Sunday morning, which is open for children.' }).status, 'REVIEW_REQUIRED', 'the booklet is missing');
});

test('an unexpected retrieval miss is classified as a retrieval problem, not a generation one', () => {
  const r = grade('S07', { retrieved_ids: ['kb-b-s01-c1', 'kb-b-s10-c1', 'kb-b-s09-c1'], source_ids: ['kb-b-s01-c1'] });
  assert.equal(r.status, 'FAIL');
  assert.equal(r.failure_type, 'retrieval');
  assert.deepEqual(r.retrieved_sections, [1, 9, 10]);
});

test('states other than a completed answer are never graded as PASS', () => {
  const c = byId.get('S01');
  assert.equal(gradeCase(c, undefined).status, 'NOT_RUN');
  assert.equal(gradeCase(c, { state: 'not_run', reason: 'cap' }).status, 'NOT_RUN');
  assert.equal(gradeCase(c, { state: 'blocked', reason: '429' }).status, 'BLOCKED');
  assert.equal(gradeCase(c, { state: 'failed', failure: { code: 'invalid_model_output' } }).status, 'FAIL');
  assert.equal(gradeCase(c, { state: 'completed', answer: '', source_ids: [] }).status, 'FAIL');
});

test('roll-up: FAIL > BLOCKED > REVIEW_REQUIRED; NOT_RUN makes the set incomplete; exit codes', () => {
  const s = (...statuses) => summarizeResults(statuses.map((status) => ({ status })));
  assert.deepEqual([s('PASS', 'PASS').status, s('PASS', 'PASS').exit_code, s('PASS', 'PASS').complete], ['PASS', 0, true]);
  assert.deepEqual([s('PASS', 'FAIL', 'BLOCKED').status, s('PASS', 'FAIL', 'BLOCKED').exit_code], ['FAIL', 1]);
  assert.deepEqual([s('PASS', 'BLOCKED').status, s('PASS', 'BLOCKED').exit_code], ['BLOCKED', 3]);
  assert.deepEqual([s('PASS', 'REVIEW_REQUIRED').status, s('PASS', 'REVIEW_REQUIRED').exit_code], ['REVIEW_REQUIRED', 4]);
  const partial = s('PASS', 'NOT_RUN');
  assert.deepEqual([partial.status, partial.complete, partial.exit_code], ['REVIEW_REQUIRED', false, 4], 'a partial run is never a clean PASS');
  assert.deepEqual([s('NOT_RUN', 'NOT_RUN').status, s().status], ['NOT_RUN', 'NOT_RUN']);
});

test('source ids map to KB sections', () => {
  assert.equal(sectionOf('kb-b-s04-c1'), 4);
  assert.equal(sectionOf('kb-b-s10-c2'), 10);
  assert.equal(sectionOf('notes-001'), null);
  for (const chunk of chunks) assert.equal(sectionOf(chunk.source_id), chunk.section_number);
});
