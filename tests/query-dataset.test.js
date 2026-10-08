import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDatasets } from '../src/data/datasets.js';
import { createQueryDatasetTool } from '../src/tools/queryDataset.js';
import { createToolRegistry, createConfiguredToolRegistry } from '../src/tools/registry.js';
import { parseDecision } from '../src/agent/decision.js';
import { harness, tool as callTool, final } from './helpers.js';

const columns = [{ name: 'id', type: 'string' }, { name: 'group', type: 'string' }, { name: 'amount', type: 'number', scale: 2 }];
const filter = (field, op, value) => ({ field, op, value });
async function setup(t, rows = [
  { id: 'a', group: 'x', amount: '0.10' }, { id: 'b', group: 'x', amount: '0.20' },
  { id: 'c', group: 'y', amount: '-0.05' },
]) {
  const root = await mkdtemp(join(tmpdir(), 'query-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'data'));
  await writeFile(join(root, 'data/items.json'), JSON.stringify(rows));
  const datasets = await loadDatasets([{ id: 'items', file: 'data/items.json', id_column: 'id', columns }], root);
  const tool = createQueryDatasetTool(datasets);
  const registry = createToolRegistry([tool]);
  return { tool, registry, datasets, async query(args) {
    const input = { dataset_id: 'items', ...args };
    const check = registry.check('query_dataset', input, {});
    assert.equal(check.ok, true, JSON.stringify(check));
    return (await check.tool.execute(input, {})).results[0];
  } };
}

test('lookup uses AND conditions, deterministic input order, explicit limit and record provenance', async (t) => {
  const h = await setup(t);
  const result = await h.query({ operation: 'lookup', filters: [filter('group', 'eq', 'x'), filter('amount', 'gt', '0.00')], limit: 1 });
  assert.equal(result.matched_count, 2);
  assert.deepEqual(result.rows, [{ row: 1, record: { id: 'a', group: 'x', amount: '0.10' } }]);
  assert.equal(result.truncated, true);
  assert.deepEqual(result.matched_rows, [[1, 2]]);
  assert.equal(result.dataset_version, h.datasets[0].version);
});

test('count and exact sum operate on ALL matches, never just a lookup page', async (t) => {
  const h = await setup(t);
  assert.equal((await h.query({ operation: 'count', filters: [filter('group', 'eq', 'x')] })).value, 2);
  const sum = await h.query({ operation: 'sum', field: 'amount', filters: [filter('group', 'eq', 'x')] });
  assert.equal(sum.value, '0.30');
  assert.equal(sum.scale, 2);
  assert.equal((await h.query({ operation: 'sum', field: 'amount' })).value, '0.25');
});

for (const [op, value, expected] of [['eq', '0.10', 1], ['ne', '0.10', 2], ['lt', '0.10', 1], ['lte', '0.10', 2], ['gt', '0.10', 1], ['gte', '0.10', 2]]) {
  test(`numeric filter ${op} uses exact decimals`, async (t) => {
    const h = await setup(t);
    assert.equal((await h.query({ operation: 'count', filters: [filter('amount', op, value)] })).value, expected);
  });
}

test('string matching is exact and case sensitive', async (t) => {
  const h = await setup(t);
  assert.equal((await h.query({ operation: 'count', filters: [filter('group', 'eq', 'X')] })).value, 0);
  assert.equal((await h.query({ operation: 'count', filters: [filter('group', 'ne', 'x')] })).value, 1);
});

test('compare counts or sums of two groups, including equal and empty groups', async (t) => {
  const h = await setup(t);
  const args = { operation: 'compare', filters: [filter('group', 'eq', 'x')], compare_filters: [filter('group', 'eq', 'y')] };
  const counts = await h.query(args);
  assert.deepEqual(counts.values, [2, 1]);
  assert.equal(counts.relation, 'gt');
  assert.deepEqual(counts.compared_rows, [[3, 3]]);
  const sums = await h.query({ ...args, field: 'amount' });
  assert.deepEqual(sums.values, ['0.30', '-0.05']);
  assert.equal(sums.relation, 'gt');
  assert.equal((await h.query({ ...args, filters: args.compare_filters })).relation, 'eq');
  assert.equal((await h.query({ ...args, filters: [filter('group', 'eq', 'none')] })).relation, 'lt');
});

test('zero matches still provide evidence of the query, with an empty lookup and exact zero sum', async (t) => {
  const h = await setup(t);
  const filters = [filter('group', 'eq', 'none')];
  const lookup = await h.query({ operation: 'lookup', filters });
  assert.equal(lookup.matched_count, 0);
  assert.deepEqual(lookup.rows, []);
  assert.deepEqual(lookup.matched_rows, []);
  assert.ok(lookup.source_id);
  assert.equal((await h.query({ operation: 'sum', field: 'amount', filters })).value, '0.00');
});

test('source IDs are stable for equivalent default arguments and change with query or data', async (t) => {
  const h = await setup(t);
  const a = await h.query({ operation: 'count' });
  const b = await h.query({ filters: [], operation: 'count' });
  assert.equal(a.source_id, b.source_id);
  assert.notEqual(a.source_id, (await h.query({ operation: 'count', filters: [filter('id', 'eq', 'a')] })).source_id);
  const changed = await setup(t, [{ id: 'a', group: 'x', amount: '1.00' }]);
  assert.notEqual(a.source_id, (await changed.query({ operation: 'count' })).source_id);
});

test('backend blocks unknown dataset, arbitrary paths, invalid fields/types/operators and ambiguous operations', async (t) => {
  const h = await setup(t);
  for (const args of [
    { dataset_id: 'secret', operation: 'count' }, { dataset_id: '../items', operation: 'count' },
    { operation: 'count', path: '../secret.json' }, { operation: 'sum' }, { operation: 'sum', field: 'group' },
    JSON.parse('{"operation":"count","constructor":"untrusted"}'),
    JSON.parse('{"operation":"count","__proto__":{"operation":"sum"}}'),
    { operation: 'compare' }, { operation: 'count', field: 'amount' }, { operation: 'count', limit: 1 },
    { operation: 'lookup', compare_filters: [] }, { operation: 'lookup', limit: 0 }, { operation: 'lookup', limit: 11 },
    { operation: 'count', filters: [filter('missing', 'eq', 'a')] },
    { operation: 'count', filters: [filter('group', 'gt', 'x')] },
    { operation: 'count', filters: [filter('amount', 'eq', '')] },
    { operation: 'count', filters: [filter('amount', 'eq', 'NaN')] },
    { operation: 'count', filters: [filter('amount', 'eq', 'Infinity')] },
    { operation: 'count', filters: [filter('amount', 'eq', '0.001')] },
    { operation: 'count', filters: [filter('amount', 'eq', 1)] },
    { operation: 'count', filters: Array.from({ length: 9 }, () => filter('id', 'eq', 'a')) },
  ]) assert.equal(h.registry.check('query_dataset', { dataset_id: 'items', ...args }, {}).ok, false, JSON.stringify(args));
  const registry = createConfiguredToolRegistry(['search_notes'], h.datasets);
  assert.equal(registry.check('query_dataset', { dataset_id: 'items', operation: 'count' }, {}).code, 'tool_not_allowed');
  assert.equal(createQueryDatasetTool([]).checkRules({ dataset_id: 'items', operation: 'count' }).length > 0, true);
});

test('result length rejects an oversized lookup without silently cutting evidence', async (t) => {
  const h = await setup(t, Array.from({ length: 5 }, (_, i) => ({ id: String(i), group: 'x'.repeat(500), amount: '1.00' })));
  await assert.rejects(h.query({ operation: 'lookup', limit: 5 }), /result.*limit|too long/i);
  assert.equal((await h.query({ operation: 'count' })).value, 5);
  assert.equal((await h.query({ operation: 'lookup', limit: 1 })).rows.length, 1);
});

test('sum uses BigInt internally and returns exact totals beyond safe Number range', async (t) => {
  const h = await setup(t, [{ id: 'a', group: 'x', amount: '90071992547409.91' }, { id: 'b', group: 'x', amount: '90071992547409.91' }]);
  assert.equal((await h.query({ operation: 'sum', field: 'amount' })).value, '180143985094819.82');
});

test('longest allowed dataset ID produces a source valid under the unchanged final contract', async (t) => {
  const h = await setup(t);
  const tool = createQueryDatasetTool([{ ...h.datasets[0], id: 'a'.repeat(40) }]);
  const result = (await tool.execute({ dataset_id: 'a'.repeat(40), operation: 'count' })).results[0];
  const parsed = parseDecision(JSON.stringify({ type: 'final', answer: 'Three records.', source_ids: [result.source_id], unresolved: '' }), { maxAnswerChars: 2000, maxModelReplyChars: 8000 });
  assert.equal(parsed.ok, true);
  assert.ok(result.source_id.length <= 60);
});

function decodeOrdinals(provenance) {
  if (Array.isArray(provenance)) return provenance.flatMap(([start, end]) => Array.from({ length: end - start + 1 }, (_, i) => start + i));
  assert.equal(provenance.encoding, 'bitmap-lsb0-base64');
  const bits = Buffer.from(provenance.bits, 'base64');
  return Array.from({ length: provenance.total_rows }, (_, i) => i + 1).filter((n) => bits[(n - 1) >> 3] & (1 << ((n - 1) & 7)));
}

async function countsFixture(t, rows) {
  const h = await setup(t, rows);
  const registry = createConfiguredToolRegistry(['compare_counts'], h.datasets);
  const args = { dataset_id: 'items', filters: [], compare_filters: [] };
  return { ...h, registry, args, async compare(overrides = {}) {
    const input = { ...args, ...overrides }, checked = registry.check('compare_counts', input, {});
    assert.equal(checked.ok, true, JSON.stringify(checked));
    return (await checked.tool.execute(input)).results[0];
  } };
}

test('compare_counts requires explicit groups and preserves the existing engine evidence and source IDs', async (t) => {
  const h = await countsFixture(t);
  const tool = h.registry.get('compare_counts');
  assert.equal(tool.access, 'read'); assert.equal(tool.requiresApproval, false);
  for (const [filters, compare_filters, expected, relation] of [
    [[], [], [3, 3], 'eq'],
    [[filter('group', 'eq', 'x')], [filter('group', 'eq', 'y')], [2, 1], 'gt'],
    [[filter('group', 'eq', 'absent')], [], [0, 3], 'lt'],
    [[filter('group', 'eq', 'absent')], [filter('id', 'eq', 'absent')], [0, 0], 'eq'],
    [[filter('group', 'eq', 'x')], [], [2, 3], 'lt'], // overlapping groups are independent
    [[filter('group', 'eq', 'x'), filter('amount', 'gte', '0.20')], [filter('amount', 'lt', '0.10')], [1, 1], 'eq'],
  ]) {
    const result = await h.compare({ filters, compare_filters });
    assert.deepEqual(result.values, expected); assert.equal(result.relation, relation);
    assert.deepEqual(result, await h.query({ operation: 'compare', filters, compare_filters }));
    assert.equal(result.dataset_version, h.datasets[0].version);
  }
});

test('compare_counts rejects unused/null/unknown arguments, unsafe IDs, invalid filters and missing groups', async (t) => {
  const h = await countsFixture(t);
  for (const change of [
    { operation: 'compare' }, { field: 'amount' }, { field: null }, { limit: 10 }, { limit: null },
    { path: 'data/items.json' }, { endpoint: 'http://example.invalid' }, { formula: 'count(*)' },
    { filters: null }, { compare_filters: null }, { dataset_id: null }, { dataset_id: '../items' }, { dataset_id: 'secret' },
    { filters: [filter('missing', 'eq', 'x')] }, { compare_filters: [filter('group', 'gt', 'x')] },
    { filters: [filter('amount', 'eq', 'NaN')] }, { filters: [filter('amount', 'eq', '0.001')] },
    { filters: [filter('amount', 'eq', 1)] }, { filters: [filter('group', 'like', 'x')] },
    { compare_filters: Array.from({ length: 9 }, () => filter('id', 'eq', 'a')) },
  ]) {
    const input = { ...h.args, ...change };
    assert.equal(h.registry.check('compare_counts', input, {}).ok, false, JSON.stringify(input));
  }
  for (const key of ['dataset_id', 'filters', 'compare_filters']) {
    const input = { ...h.args }; delete input[key];
    assert.equal(h.registry.check('compare_counts', input, {}).code, 'invalid_arguments');
  }
  assert.equal(createConfiguredToolRegistry(['query_dataset'], h.datasets).check('compare_counts', h.args, {}).code, 'tool_not_allowed');
  assert.equal(createConfiguredToolRegistry(['compare_counts']).check('compare_counts', h.args, {}).code, 'rule_violation');
});

test('compare_counts over 200 alternating rows reaches the Agent final with full bounded provenance', async (t) => {
  const h = await countsFixture(t, Array.from({ length: 200 }, (_, i) => ({ id: String(i), group: i % 2 ? 'y' : 'x', amount: '1.00' })));
  const args = { ...h.args, filters: [filter('group', 'eq', 'x')], compare_filters: [filter('group', 'eq', 'y')] };
  const agent = await harness({ registry: h.registry, replies: [callTool('compare_counts', args), (messages) => {
    const message = messages.findLast((m) => m.content.startsWith('OBSERVATION'));
    const obs = JSON.parse(message.content.slice(message.content.indexOf('{'))), e = obs.untrusted_data.results[0];
    assert.equal(obs.tool, 'compare_counts'); assert.equal(obs.status, 'ok');
    assert.ok(JSON.stringify(obs).length <= 1500);
    assert.deepEqual(e.values, [100, 100]); assert.equal(e.relation, 'eq');
    assert.deepEqual(decodeOrdinals(e.matched_rows), Array.from({ length: 100 }, (_, i) => i * 2 + 1));
    assert.deepEqual(decodeOrdinals(e.compared_rows), Array.from({ length: 100 }, (_, i) => i * 2 + 2));
    assert.equal(e.dataset_version, h.datasets[0].version);
    return final('x = 100; y = 100; x = y.', [e.source_id]);
  }] }); t.after(agent.cleanup);
  const run = await agent.run('Compare the counts of x and y.');
  assert.equal(run.status, 'completed'); assert.equal(run.repairs_used, 0);
  assert.deepEqual(run.final.source_ids, run.retrieved_source_ids);
  assert.equal((await agent.store.listDrafts()).length, 0);
});

test('200 alternating rows compare exact counts/sums with lossless provenance below the observation limit', async (t) => {
  const h = await setup(t, Array.from({ length: 200 }, (_, i) => ({ id: String(i), group: i % 2 ? 'y' : 'x', amount: i % 2 ? '2.00' : '1.00' })));
  const args = { operation: 'compare', filters: [filter('group', 'eq', 'x')], compare_filters: [filter('group', 'eq', 'y')] };
  assert.equal((await h.query({ operation: 'count', filters: args.filters })).value, 100);
  assert.equal((await h.query({ operation: 'sum', field: 'amount', filters: args.filters })).value, '100.00');
  const counts = await h.query(args);
  assert.deepEqual(counts.values, [100, 100]);
  assert.equal(counts.relation, 'eq');
  const sums = await h.query({ ...args, field: 'amount' });
  assert.deepEqual(sums.values, ['100.00', '200.00']);
  assert.equal(sums.relation, 'lt');
  assert.deepEqual(decodeOrdinals(sums.matched_rows), Array.from({ length: 100 }, (_, i) => i * 2 + 1));
  assert.deepEqual(decodeOrdinals(sums.compared_rows), Array.from({ length: 100 }, (_, i) => i * 2 + 2));
  assert.equal(sums.dataset_version, h.datasets[0].version);
  assert.ok(JSON.stringify({ tool: 'query_dataset', status: 'ok', untrusted_data: { count: 1, results: [sums] } }).length <= 1500);
});

test('Agent observes and cites the complete comparison over 200 alternating rows', async (t) => {
  const h = await setup(t, Array.from({ length: 200 }, (_, i) => ({ id: String(i), group: i % 2 ? 'y' : 'x', amount: i % 2 ? '2.00' : '1.00' })));
  const args = { dataset_id: 'items', operation: 'compare', field: 'amount', filters: [filter('group', 'eq', 'x')], compare_filters: [filter('group', 'eq', 'y')] };
  let source;
  const agent = await harness({ registry: h.registry, replies: [callTool('query_dataset', args), (messages) => {
    const message = messages.findLast((m) => m.content.startsWith('OBSERVATION'));
    const obs = JSON.parse(message.content.slice(message.content.indexOf('{')));
    assert.equal(obs.status, 'ok');
    const evidence = obs.untrusted_data.results[0];
    assert.deepEqual(evidence.values, ['100.00', '200.00']);
    assert.equal(decodeOrdinals(evidence.matched_rows).length, 100);
    assert.equal(decodeOrdinals(evidence.compared_rows).length, 100);
    source = evidence.source_id;
    return final('x = 100.00; y = 200.00; x < y.', [source]);
  }] });
  t.after(agent.cleanup);
  const run = await agent.run('Compare both groups without narrowing conditions.');
  assert.equal(run.status, 'completed');
  assert.equal(run.repairs_used, 0);
  assert.deepEqual(run.final.source_ids, [source]);
});
