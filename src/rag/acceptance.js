// Grader for eval/sunrise-acceptance.json. Expected values in that file were written by hand from the KB text;
// nothing here derives an expectation from a retriever or model output.
//
// Statuses per case: PASS | FAIL | REVIEW_REQUIRED | BLOCKED | NOT_RUN
//   - hard checks (money, required citations, fabricated facts, language) can FAIL a case;
//   - soft checks (prose wording) can only turn a case into REVIEW_REQUIRED;
//   - PASS means "every automatic check passed". It never proves that all prose claims are right, and a scripted
//     (mock) PASS says nothing about a real model.
// Numbers are parsed as amounts (450,000 = 450.000 = 450000 = 450k = 0,45 triệu); a digit never matches by substring.

/** Lowercase, strip accents (đ -> d) and collapse whitespace, so Vietnamese and English share word lists. */
export function fold(text) {
  return String(text ?? '').normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ── amounts ─────────────────────────────────────────────────────────────────────────────────────────────────
const AMOUNT = /(?<![\d.,])(\d{1,3}(?:[.,   ]\d{3})+|\d+(?:[.,]\d+)?)(?!\d)\s*(k\b|nghin\b|ngan\b|trieu\b|tr\b|million\b|vnd\b|dong\b)?/g;

/** Amounts in a string (any text; it is folded first). `money` marks tokens we accept as a price. */
export function extractAmounts(text) {
  const folded = fold(text);
  const found = [];
  for (const m of folded.matchAll(AMOUNT)) {
    const raw = m[1], unit = m[2] ?? null;
    const grouped = /^\d{1,3}(?:[.,   ]\d{3})+$/.test(raw);
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

// ── sentences, clauses, term matching ──────────────────────────────────────────────────────────────────────
const BULLET = /^\s*(?:[-*•]|\d{1,2}[.)])\s+/;

/** Sentences of an answer. Bullets and blank lines separate; a line break inside a paragraph does not. */
export function sentencesOf(text) {
  const blocks = [];
  for (const line of String(text ?? '').replace(/\r/g, '').split('\n')) {
    if (!line.trim()) { blocks.push(null); continue; }
    if (blocks.length && blocks.at(-1) !== null && !BULLET.test(line) && !/[.!?]\s*$/.test(blocks.at(-1))) blocks[blocks.length - 1] += ` ${line.trim()}`;
    else blocks.push(line.trim());
  }
  const out = [];
  for (const block of blocks.filter(Boolean)) for (const s of block.split(/(?<=[.!?;])\s+/)) if (s.trim()) out.push(s.trim());
  return out;
}

const CLAUSE_BREAK = /;|,\s|\s(?:but|however|whereas|while|although|though|and yet|nhung|tuy nhien|con|trong khi)\s/;
const clausesOf = (sentence) => fold(sentence).split(CLAUSE_BREAK).map((c) => c.trim()).filter(Boolean);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Does the (folded) text contain `term`? Terms are stems or phrases ("dermatolog", "thu duc", "from 1 october").
 * Short terms and terms written with surrounding spaces ("no ", "be ") must match whole words so that "cu" does not
 * match "cung" and "old" does not match "household"; longer terms match from a word start.
 */
export function termIn(foldedText, term) {
  const raw = String(term);
  const needle = fold(raw);
  if (!needle) return false;
  const strict = raw !== raw.trim() || needle.length <= 3;
  return new RegExp(`(?<![a-z0-9])${escape(needle)}${strict ? '(?![a-z0-9])' : ''}`).test(foldedText);
}
const anyTerm = (folded, terms = []) => terms.some((t) => termIn(folded, t));

// ── language ─────────────────────────────────────────────────────────────────────────────────────────────────
const VI_LETTERS = /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/gi;
// Words that are not also unaccented Vietnamese syllables (so "it", "an", "can", "do" are left out).
const EN_WORDS = new Set(['the', 'is', 'are', 'was', 'were', 'of', 'and', 'for', 'you', 'your', 'with', 'this', 'that', 'not', 'does', 'from', 'has', 'have', 'there', 'which', 'before', 'after', 'until', 'will', 'would', 'at', 'in', 'also', 'branch', 'only', 'please', 'yes', 'when', 'what', 'where', 'been']);

/** 'vi' | 'en' | 'unknown'. Conservative: a Vietnamese answer without diacritics is "unknown", not "en". */
export function detectLanguage(text) {
  const s = String(text ?? '');
  const letters = (s.match(/\p{L}/gu) ?? []).length;
  const marks = (s.match(VI_LETTERS) ?? []).length;
  if (letters && marks >= 3 && marks / letters >= 0.04) return 'vi';
  const words = new Set(fold(s).split(/[^a-z]+/).filter((w) => EN_WORDS.has(w)));
  if (words.size >= 2 && marks / Math.max(letters, 1) < 0.02) return 'en';
  return 'unknown';
}

// ── abstention ─────────────────────────────────────────────────────────────────────────────────────────────
const ABSTAIN = ['does not provide', 'do not provide', 'not provide', 'does not contain', 'not contain', 'does not mention', 'not mention', 'does not say', 'does not specify', 'no information',
  'cannot find', 'can not find', 'could not find', 'not found in', 'not available in', 'not included', 'not listed', 'not in the', "don't know", 'do not know', 'unable to',
  'khong cung cap', 'khong co thong tin', 'khong de cap', 'khong neu', 'khong tim thay', 'khong ghi', 'khong biet', 'khong co trong', 'khong duoc neu', 'chua co thong tin'];

// ── single checks ─────────────────────────────────────────────────────────────────────────────────────────────
const fmt = (n) => n.toLocaleString('en-US');
const outcomeOf = (level, pass, label, detail) => ({ level, status: pass ? 'pass' : level === 'hard' ? 'fail' : 'review', label, detail });

const subjectHit = (sentence, check) => anyTerm(fold(sentence), check.subject_any ?? []);

function amountFor(check, answer, level) {
  const sentences = sentencesOf(answer);
  const hit = sentences.find((s) => subjectHit(s, check) && extractAmounts(s).some((a) => a.value === check.amount));
  const label = check.label ?? `states ${fmt(check.amount)} VND for ${check.subject_any[0]}`;
  if (hit) return outcomeOf(level, true, label, `"${hit}"`);
  const near = sentences.filter((s) => subjectHit(s, check)).map((s) => extractAmounts(s).filter((a) => a.money).map((a) => fmt(a.value)).join('/') || 'none');
  return outcomeOf(level, false, label, `no sentence about ${check.subject_any[0]} contains ${fmt(check.amount)}; amounts near the subject: ${near.length ? near.join(' | ') : 'subject not mentioned'}`);
}

function forbidAmountFor(check, answer, level) {
  const label = check.label ?? `does not state ${fmt(check.amount)} VND for ${check.subject_any[0]}`;
  const bad = sentencesOf(answer).find((s) => subjectHit(s, check) && extractAmounts(s).some((a) => a.value === check.amount) && !anyTerm(fold(s), check.allow_context_any ?? []));
  return outcomeOf(level, !bad, label, bad ? `"${bad}"` : 'not stated');
}

function forbidTextNear(check, answer, level) {
  const token = new RegExp(`(?<![a-z0-9])${escape(fold(check.pattern))}(?![a-z0-9])`);
  const bad = sentencesOf(answer).find((s) => { const f = fold(s); return token.test(f) && anyTerm(f, check.near_any) && !anyTerm(f, check.unless_any ?? []); });
  return outcomeOf(level, !bad, check.label ?? `no "${check.pattern}" near ${check.near_any[0]}`, bad ? `"${bad}"` : 'not found');
}

function forbidAnyAmount(check, answer, level) {
  let bad = null;
  for (const sentence of sentencesOf(answer)) for (const clause of clausesOf(sentence)) {
    if (anyTerm(clause, check.subject_any) && extractAmounts(clause).some((a) => a.money)) { bad = clause; break; }
  }
  return outcomeOf(level, !bad, check.label ?? `no amount about ${check.subject_any[0]}`, bad ? `"${bad}"` : 'no amount next to the subject');
}

function allGroups(check, answer, level) {
  const folded = fold(answer);
  const missing = check.groups.filter((group) => !anyTerm(folded, group));
  return outcomeOf(level, !missing.length, check.label, missing.length ? `missing: ${missing.map((g) => g[0]).join(', ')}` : 'all groups present');
}
function anyOf(check, answer, level) {
  const folded = fold(answer);
  const hit = check.any_of.find((t) => termIn(folded, t));
  return outcomeOf(level, Boolean(hit), check.label, hit ? `matched "${hit}"` : `none of: ${check.any_of.slice(0, 4).join(', ')}…`);
}
function flagCooccur(check, answer, level) {
  const bad = sentencesOf(answer).find((s) => { const f = fold(s); return anyTerm(f, check.a_any) && anyTerm(f, check.b_any) && !anyTerm(f, check.unless_any ?? []); });
  return outcomeOf(level, !bad, check.label, bad ? `"${bad}"` : 'not flagged');
}
function abstain(check, answer, level, outcome) {
  const said = ABSTAIN.find((p) => fold(answer).includes(p));
  const flagged = Boolean(String(outcome.unresolved ?? '').trim());
  return outcomeOf(level, Boolean(said) || flagged, check.label ?? 'says the KB does not provide this', said ? `matched "${said}"` : flagged ? 'unresolved field is set' : 'no abstention wording and no unresolved note');
}

const CHECKS = { amount_for: amountFor, forbid_amount_for: forbidAmountFor, forbid_text_near: forbidTextNear, forbid_any_amount: forbidAnyAmount,
  all_groups: allGroups, any_of: anyOf, flag_cooccur: flagCooccur, abstain };
export const CHECK_TYPES = Object.keys(CHECKS);

/** Run one manifest check against an answer. */
export function runCheck(check, answer, level, outcome = {}) {
  const fn = CHECKS[check.type];
  if (!fn) throw new Error(`Unknown check type "${check.type}".`);
  return { type: check.type, ...fn(check, answer, level, outcome) };
}

// ── citations ─────────────────────────────────────────────────────────────────────────────────────────────────
export const sectionOf = (sourceId) => { const m = /-s(\d+)-c\d+$/.exec(String(sourceId)); return m ? Number(m[1]) : null; };
const uniq = (list) => [...new Set(list)];

/**
 * Grade one case. `outcome`:
 *   { state: 'completed'|'failed'|'stopped'|'blocked'|'not_run', answer?, source_ids?, unresolved?, retrieved_ids?, failure?, reason? }
 * Returns { id, status, checks[], cited_sections, retrieved_sections, failure_type, reasons[] }.
 */
export function gradeCase(testCase, outcome) {
  const base = { id: testCase.id, title: testCase.title, kind: testCase.kind, language: testCase.language, answer_language: testCase.answer_language };
  if (!outcome || outcome.state === 'not_run') return { ...base, status: 'NOT_RUN', checks: [], reasons: [outcome?.reason ?? 'not attempted'], failure_type: null };
  if (outcome.state === 'blocked') return { ...base, status: 'BLOCKED', checks: [], reasons: [outcome.reason ?? 'provider or embedding service unavailable'], failure_type: 'provider' };
  if (outcome.state !== 'completed' || typeof outcome.answer !== 'string') {
    return { ...base, status: 'FAIL', checks: [], reasons: [`run ${outcome.state}${outcome.failure ? `: ${outcome.failure.code}` : ''}`], failure_type: 'run' };
  }
  const checks = [];
  const add = (level, pass, label, detail) => checks.push({ type: 'source', ...outcomeOf(level, pass, label, detail) });
  const cited = uniq(outcome.source_ids ?? []);
  const retrieved = uniq(outcome.retrieved_ids ?? []);
  const citedSections = uniq(cited.map(sectionOf).filter((n) => n != null)).sort((a, b) => a - b);
  const retrievedSections = uniq(retrieved.map(sectionOf).filter((n) => n != null)).sort((a, b) => a - b);

  if (outcome.retrieved_ids) add('hard', cited.every((id) => retrieved.includes(id)), 'every cited source was shown to the model', cited.filter((id) => !retrieved.includes(id)).join(', ') || 'yes');
  const wants = testCase.sources ?? {};
  if (wants.expect_none) add('hard', cited.length === 0, 'cites no source (the KB has no answer)', cited.length ? `cited ${cited.join(', ')}` : 'none cited');
  for (const n of wants.required_sections ?? []) add('hard', citedSections.includes(n), `cites section ${n}`, citedSections.includes(n) ? 'cited' : `cited sections: ${citedSections.join(', ') || 'none'}`);
  for (const n of wants.expected_sections ?? []) if (outcome.retrieved_ids) add('soft', retrievedSections.includes(n), `section ${n} was retrieved`, retrievedSections.includes(n) ? 'retrieved' : `retrieved sections: ${retrievedSections.join(', ') || 'none'}`);

  const detected = detectLanguage(outcome.answer);
  if (detected === 'unknown') add('soft', false, `answer language is ${testCase.answer_language}`, 'language could not be detected automatically; read the answer');
  else add('hard', detected === testCase.answer_language, `answer language is ${testCase.answer_language}`, `detected ${detected}`);

  for (const check of testCase.hard ?? []) checks.push(runCheck(check, outcome.answer, 'hard', outcome));
  for (const check of testCase.soft ?? []) checks.push(runCheck(check, outcome.answer, 'soft', outcome));

  const failed = checks.filter((c) => c.status === 'fail'), review = checks.filter((c) => c.status === 'review');
  const status = failed.length ? 'FAIL' : review.length ? 'REVIEW_REQUIRED' : 'PASS';
  const missingRetrieval = outcome.retrieved_ids && [...(wants.required_sections ?? []), ...(wants.expected_sections ?? [])].some((n) => !retrievedSections.includes(n));
  const failure_type = status === 'PASS' ? null : missingRetrieval ? 'retrieval' : failed.some((c) => c.label.startsWith('every cited')) ? 'grounding' : failed.some((c) => c.label.startsWith('answer language')) ? 'language' : 'generation';
  return { ...base, status, checks, cited_sections: citedSections, retrieved_sections: retrievedSections, failure_type,
    reasons: [...failed, ...review].map((c) => `${c.level === 'hard' ? 'FAIL' : 'REVIEW'}: ${c.label} — ${c.detail}`) };
}

/** Roll results up. FAIL > BLOCKED > REVIEW_REQUIRED > PASS; any NOT_RUN makes the set incomplete (never a clean PASS). */
export function summarizeResults(results) {
  const counts = { PASS: 0, FAIL: 0, REVIEW_REQUIRED: 0, BLOCKED: 0, NOT_RUN: 0 };
  for (const r of results) counts[r.status] += 1;
  const complete = counts.NOT_RUN === 0 && results.length > 0;
  const status = counts.FAIL ? 'FAIL' : counts.BLOCKED ? 'BLOCKED' : counts.REVIEW_REQUIRED ? 'REVIEW_REQUIRED' : results.length === counts.NOT_RUN ? 'NOT_RUN' : complete ? 'PASS' : 'REVIEW_REQUIRED';
  // 0 = every case ran and every automatic check passed; 1 = a failure; 3 = blocked; 4 = something needs a human or did not run.
  const exit_code = status === 'FAIL' ? 1 : status === 'BLOCKED' ? 3 : status === 'PASS' ? 0 : 4;
  return { status, complete, counts, exit_code };
}

/** Structural checks on the manifest itself (types, ids, section numbers, language fields). */
export function validateManifest(manifest, { sectionNumbers }) {
  const problems = [];
  if (manifest.format !== 'sunrise-acceptance-v1') problems.push('format must be sunrise-acceptance-v1');
  const ids = new Set();
  for (const c of manifest.cases ?? []) {
    if (ids.has(c.id)) problems.push(`${c.id}: duplicate id`);
    ids.add(c.id);
    if (!['answer', 'unknown', 'injection'].includes(c.kind)) problems.push(`${c.id}: bad kind`);
    for (const key of ['language', 'answer_language']) if (!['en', 'vi'].includes(c[key])) problems.push(`${c.id}: bad ${key}`);
    for (const n of [...(c.sources?.required_sections ?? []), ...(c.sources?.expected_sections ?? [])]) if (!sectionNumbers.includes(n)) problems.push(`${c.id}: section ${n} is not in the KB`);
    for (const level of ['hard', 'soft']) for (const check of c[level] ?? []) if (!CHECK_TYPES.includes(check.type)) problems.push(`${c.id}: unknown ${level} check ${check.type}`);
    if (c.kind === 'unknown' && !c.sources?.expect_none) problems.push(`${c.id}: an unknown case must expect no source`);
  }
  for (const id of manifest.live_priority ?? []) if (!ids.has(id)) problems.push(`live_priority ${id} is not a case`);
  return problems;
}
