import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT } from './helpers.js';
import { scaffoldFixture } from './scaffold-helpers.js';
import { scaffoldProject } from '../src/scaffold/apply.js';
import { runAcceptanceTask, gradeReadEvidence } from '../src/scaffold/acceptance.js';

for (const template of ['notes', 'dataset-read', 'proposal']) test(`${template}: generated acceptance uses real runner/evidence/store and npm test discovers generated driver`, async (t) => {
  const { root, spec } = await scaffoldFixture(t, template);
  for (const folder of ['src', 'eval']) await cp(join(ROOT, folder), join(root, folder), { recursive: true });
  await cp(join(ROOT, 'package.json'), join(root, 'package.json'));
  await scaffoldProject({ root, spec, apply: true, register: true });
  const report = await runAcceptanceTask({ root, id: spec.task.id });
  assert.equal(report.status, 'PASS', JSON.stringify(report.results));
  assert.equal(report.results.length, spec.cases.length); assert.equal(report.provider_requests, 0);
  assert.ok(report.results.every((r) => r.dataset_unchanged));
  if (template === 'proposal') {
    assert.equal(report.results.find((r) => r.id === 'approve').proposals, 1);
    assert.equal(report.results.find((r) => r.id === 'reject').proposals, 0);
    assert.ok(report.results.filter((r) => ['approve', 'reject'].includes(r.id)).every((r) => r.replayed));
  }
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const output = await promisify(execFile)(process.execPath, ['--test', '--test-reporter=spec', 'tests/*.test.js'], { cwd: root, env });
  assert.match(output.stdout, /tests 1/); assert.match(output.stdout, /fail 0/);
});
test('independently authored wrong expected is FAIL, never regenerated from actual tool output', async (t) => {
  const { root, spec } = await scaffoldFixture(t); spec.cases[0].expected.value = '999.99';
  await scaffoldProject({ root, spec, apply: true });
  const result = await runAcceptanceTask({ root, id: spec.task.id });
  assert.equal(result.status, 'FAIL'); assert.equal(result.results[0].status, 'FAIL');
});
test('read grader rejects fake citation, changed snapshot, wrong record and swapped comparison groups/relation', () => {
  const c = { tool: 'compare_counts', args: { dataset_id: 'x', filters: [], compare_filters: [] }, expected: { matched_count: 2, compared_count: 1, values: ['2', '1'], relation: 'gt' } };
  const data = { id: 'x', version: 'snapshot', idColumn: 'key' };
  const e = { source_id: 'ds-x-test', dataset_id: 'x', dataset_version: 'snapshot', query: { operation: 'compare', filters: [], compare_filters: [] }, matched_count: 2, compared_count: 1, values: [2, 1], relation: 'gt' };
  const run = { retrieved_source_ids: ['ds-x-test'], final: { source_ids: ['ds-x-test'] } };
  assert.deepEqual(gradeReadEvidence(c, run, [e], [data]), []);
  for (const mutate of [(x) => x.dataset_version = 'old', (x) => x.values.reverse(), (x) => x.relation = 'lt']) {
    const altered = structuredClone(e); mutate(altered); assert.ok(gradeReadEvidence(c, run, [altered], [data]).length);
  }
  assert.ok(gradeReadEvidence(c, { ...run, final: { source_ids: ['fake'] } }, [e], [data]).length);
  const lookup = { ...c, tool: 'query_dataset', args: { dataset_id: 'x', operation: 'lookup', filters: [], limit: 1 }, expected: { matched_count: 1, record_ids: ['wanted'] } };
  assert.ok(gradeReadEvidence(lookup, run, [{ ...e, matched_count: 1, query: { operation: 'lookup', filters: [], limit: 1 }, rows: [{ record: { key: 'wrong' } }] }], [data]).length);
});
