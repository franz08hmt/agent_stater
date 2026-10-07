// A deliberately narrow smoke grader, not a natural-language correctness judge.
// PASS covers exact observed evidence and the documented answer form only.
import { canonicalJson } from '../src/agent/state.js';

const escape = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const verdict = (status, reason) => ({ status, reason });

export function evaluateDatasetDemo({ run, observations, expectedEvidence, answerSpec }) {
  if (run?.status !== 'completed' || !run.final || run.approvals?.length !== 0) {
    return verdict('FAIL', 'Run must complete without any write approval.');
  }
  if (!run.trace?.some((entry) => entry.kind === 'tool' && entry.tool_name === 'query_dataset' && entry.status === 'ok')) {
    return verdict('FAIL', 'No successful query_dataset execution.');
  }
  const cited = run.final.source_ids;
  if (!Array.isArray(cited) || !cited.length || cited.some((id) => id !== expectedEvidence.source_id || !run.retrieved_source_ids.includes(id))) {
    return verdict('FAIL', 'Final must cite the evidence for the expected query and snapshot.');
  }
  const evidence = observations.filter((obs) => obs.tool === 'query_dataset' && obs.status === 'ok')
    .flatMap((obs) => obs.untrusted_data?.results || []).find((e) => e.source_id === expectedEvidence.source_id);
  if (!evidence || canonicalJson(evidence) !== canonicalJson(expectedEvidence)) {
    return verdict('FAIL', 'Cited observation does not match expected query, version, records and calculation.');
  }
  const answer = run.final.answer;
  if (typeof answer !== 'string') return verdict('FAIL', 'Missing answer text.');
  // Compare WHOLE numeric lexemes, including signs and decimal separators.
  // In particular 12, 2.5 and -2 must never count as the token 2.
  const tokens = answer.match(/(?<![\p{L}\p{N}_])[-+]?\d+(?:[.,]\d+)*(?![\p{L}\p{N}_])/gu) || [];
  const expectedTokens = (answerSpec.groups ? evidence.values : [evidence.value]).map(String);
  if (canonicalJson([...tokens].sort()) !== canonicalJson([...expectedTokens].sort())) {
    return verdict('FAIL', 'Answer numeric tokens do not exactly match the calculation.');
  }
  let form;
  if (answerSpec.groups) {
    const [left, right] = answerSpec.groups.map(escape);
    const [leftValue, rightValue] = evidence.values.map(String);
    for (const [label, value] of [[left, leftValue], [right, rightValue]]) {
      const assignments = [...answer.matchAll(new RegExp(`(?<![\\p{L}\\p{N}_])${label}\\s*=\\s*([-+]?\\d+(?:[.,]\\d+)*)`, 'giu'))];
      if (assignments.some((match) => match[1] !== value)) return verdict('FAIL', 'Answer assigns a total to the wrong group.');
    }
    const symbol = { lt: '<', eq: '=', gt: '>' }[evidence.relation];
    if (!symbol) return verdict('FAIL', 'Invalid comparison relation in evidence.');
    const relations = [...answer.matchAll(new RegExp(`${left}\\s*([<>=])\\s*${right}(?![\\p{L}\\p{N}_])`, 'giu'))];
    if (relations.some((match) => match[1] !== symbol)) return verdict('FAIL', 'Answer contradicts the group relation.');
    form = new RegExp(`^\\s*${left}\\s*=\\s*${escape(leftValue)}\\s*;\\s*${right}\\s*=\\s*${escape(rightValue)}\\s*;\\s*${left}\\s*${symbol}\\s*${right}\\s*[.!]?\\s*$`, 'iu');
  } else {
    const unit = answerSpec.unit ? `\\s+${escape(answerSpec.unit)}` : '';
    form = new RegExp(`^\\s*${escape(answerSpec.label)}\\s*=\\s*${escape(evidence.value)}${unit}\\s*[.!]?\\s*$`, 'iu');
  }
  if (!form.test(answer) || run.final.unresolved?.trim()) return verdict('REVIEW_REQUIRED', 'Evidence and numbers checked; prose/group meaning or unresolved text needs manual reading.');
  return verdict('PASS', 'Exact evidence, numeric values and declared answer form checked; broader language semantics are not graded.');
}
