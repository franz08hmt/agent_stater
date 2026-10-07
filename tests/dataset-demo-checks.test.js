import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDatasetDemo } from '../scripts/datasetDemoChecks.js';

function fixture(comparison = false) {
  const expectedEvidence = {
    source_id: 'ds-classes-demo', dataset_id: 'classes', dataset_version: 'a'.repeat(64),
    query: { operation: comparison ? 'compare' : 'count', filters: [{ field: 'day', op: 'eq', value: 'Mon' }] },
    matched_count: 2, matched_rows: [[1, 2]],
    ...(comparison ? { values: ['55', '40'], relation: 'gt', compared_rows: [[3, 3]], compared_count: 1 } : { value: 2 }),
  };
  if (comparison) Object.assign(expectedEvidence.query, { field: 'students', compare_filters: [{ field: 'day', op: 'eq', value: 'Tue' }] });
  const run = {
    status: 'completed', approvals: [], retrieved_source_ids: [expectedEvidence.source_id],
    trace: [{ kind: 'tool', tool_name: 'query_dataset', status: 'ok' }],
    final: { answer: comparison ? 'Mon = 55; Tue = 40; Mon > Tue.' : 'Mon = 2 lớp.', source_ids: [expectedEvidence.source_id], unresolved: '' },
  };
  const observations = [{ tool: 'query_dataset', status: 'ok', untrusted_data: { count: 1, results: [structuredClone(expectedEvidence)] } }];
  return { run, observations, expectedEvidence, answerSpec: comparison ? { groups: ['Mon', 'Tue'] } : { label: 'Mon', unit: 'lớp' } };
}

test('smoke rejects 12 classes when the expected count is 2', () => {
  const input = fixture();
  input.run.final.answer = '12 lớp';
  assert.equal(evaluateDatasetDemo(input).status, 'FAIL');
});

test('smoke rejects swapped group totals even though both expected numeric tokens are present', () => {
  const input = fixture(true);
  input.run.final.answer = 'Mon = 40, Tue = 55';
  assert.equal(evaluateDatasetDemo(input).status, 'FAIL');
});

test('smoke rejects a relation contradicting the exact group totals', () => {
  const input = fixture(true);
  input.run.final.answer = 'Mon = 55; Tue = 40; Mon < Tue.';
  assert.equal(evaluateDatasetDemo(input).status, 'FAIL');
});

test('smoke accepts the checked scalar and group assignment forms with cited evidence', () => {
  assert.equal(evaluateDatasetDemo(fixture()).status, 'PASS');
  assert.equal(evaluateDatasetDemo(fixture(true)).status, 'PASS');
});

test('correct-looking prose and unlabeled totals require manual review instead of PASS', () => {
  const input = fixture();
  input.run.final.answer = 'Có 2 lớp vào ngày Mon.';
  assert.equal(evaluateDatasetDemo(input).status, 'REVIEW_REQUIRED');
  const compare = fixture(true);
  compare.run.final.answer = 'Hai tổng là 55 và 40.';
  assert.equal(evaluateDatasetDemo(compare).status, 'REVIEW_REQUIRED');
});

test('unresolved prose requires manual reading even with a valid formatted answer', () => {
  const input = fixture();
  input.run.final.unresolved = 'No class count is available.';
  assert.equal(evaluateDatasetDemo(input).status, 'REVIEW_REQUIRED');
});

test('smoke requires the exact expected query, dataset version and calculation in observed evidence', () => {
  for (const mutate of [
    (e) => { e.query.filters[0].value = 'Tue'; },
    (e) => { e.dataset_version = 'b'.repeat(64); },
    (e) => { e.value = 12; },
    (e) => { e.matched_rows = [[3, 3]]; },
  ]) {
    const input = fixture();
    mutate(input.observations[0].untrusted_data.results[0]);
    assert.equal(evaluateDatasetDemo(input).status, 'FAIL');
  }
});

test('smoke rejects another retrieved citation, missing observations, approvals or tool failures', () => {
  for (const mutate of [
    (input) => { input.run.final.source_ids = ['another']; input.run.retrieved_source_ids.push('another'); },
    (input) => { input.observations = []; },
    (input) => { input.run.approvals = [{ state: 'pending' }]; },
    (input) => { input.run.trace[0].status = 'error'; },
    (input) => { input.run.final = null; input.run.status = 'failed'; },
  ]) {
    const input = fixture();
    mutate(input);
    assert.equal(evaluateDatasetDemo(input).status, 'FAIL');
  }
});

test('smoke does not accept numeric substrings or additional contradictory numbers', () => {
  for (const answer of ['Mon = 2.5 lớp', 'Mon = 20 lớp', 'Mon = -2 lớp', 'Mon = 2 lớp, tổng 12 lớp']) {
    const input = fixture();
    input.run.final.answer = answer;
    assert.equal(evaluateDatasetDemo(input).status, 'FAIL', answer);
  }
});

test('equal and less-than group relations are graded in the declared order', () => {
  for (const [values, relation, symbol] of [[['40', '55'], 'lt', '<'], [['40', '40'], 'eq', '=']]) {
    const input = fixture(true);
    input.expectedEvidence.values = values;
    input.expectedEvidence.relation = relation;
    input.observations[0].untrusted_data.results[0] = structuredClone(input.expectedEvidence);
    input.run.final.answer = `Mon = ${values[0]}; Tue = ${values[1]}; Mon ${symbol} Tue.`;
    assert.equal(evaluateDatasetDemo(input).status, 'PASS');
  }
});
