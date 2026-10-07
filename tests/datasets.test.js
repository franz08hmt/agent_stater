import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDatasets, DATASET_LIMITS } from '../src/data/datasets.js';

export const columns = [
  { name: 'id', type: 'string' }, { name: 'group', type: 'string' },
  { name: 'amount', type: 'number', scale: 2 },
];
export const definition = { id: 'items', file: 'data/items.json', id_column: 'id', columns };

async function fixture(t, contents, file = 'items.json') {
  const root = await mkdtemp(join(tmpdir(), 'dataset-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'data'));
  await writeFile(join(root, 'data', file), contents);
  return root;
}

test('JSON snapshot preserves exact decimals, row identity and content version', async (t) => {
  const root = await fixture(t, '[{"id":"a","group":"x","amount":"0.10"},{"id":"b","group":"y","amount":0.2}]');
  const [data] = await loadDatasets([definition], root);
  assert.equal(data.rows[0].amount, '0.10');
  assert.equal(data.rows[1].amount, '0.20');
  assert.match(data.version, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(data.rows[0]));
  await writeFile(join(root, 'data/items.json'), '[{"id":"a","group":"x","amount":"0.30"}]');
  const [changed] = await loadDatasets([definition], root);
  assert.notEqual(changed.version, data.version);
  assert.equal(data.rows.length, 2);
});

test('CSV handles quoted commas, escaped quotes, CRLF and embedded newlines', async (t) => {
  const root = await fixture(t, '\uFEFFid,group,amount\r\na,"x, ""quoted""",0.10\r\nb,"two\r\nlines",0.20\r\n', 'items.csv');
  const [data] = await loadDatasets([{ ...definition, file: 'data/items.csv' }], root);
  assert.equal(data.rows[0].group, 'x, "quoted"');
  assert.equal(data.rows[1].group, 'two\r\nlines');
  assert.equal(data.rows.length, 2);
});

for (const [label, csv, message] of [
  ['duplicate header', 'id,id,amount\na,x,1', /header/i],
  ['missing header', 'id,,amount\na,x,1', /header/i],
  ['unknown header', 'id,other,amount\na,x,1', /header/i],
  ['short row', 'id,group,amount\na,x', /row/i],
  ['long row', 'id,group,amount\na,x,1,2', /row/i],
  ['unclosed quote', 'id,group,amount\na,"x,1', /CSV/i],
  ['quote in unquoted cell', 'id,group,amount\na,x"y,1', /CSV/i],
  ['text after closing quote', 'id,group,amount\na,"x"z,1', /CSV/i],
]) test(`CSV rejects ${label}`, async (t) => {
  const root = await fixture(t, csv, 'items.csv');
  await assert.rejects(loadDatasets([{ ...definition, file: 'data/items.csv' }], root), message);
});

for (const value of ['', ' ', 'oops', 'NaN', 'Infinity', '1e3', '0x10', '1,000', '0.001', '9007199254740992', null, true, 1e308]) {
  test(`numeric data rejects ${JSON.stringify(value)} instead of coercing or rounding`, async (t) => {
    const root = await fixture(t, JSON.stringify([{ id: 'a', group: 'x', amount: value }]));
    await assert.rejects(loadDatasets([definition], root), /amount|number|decimal/i);
  });
}

for (const content of ['{}', '[null]', '[{"id":"a","group":"x"}]', '[{"id":"a","group":"x","amount":1,"extra":1}]', '[{"id":"a","group":"x","amount":1},{"id":"a","group":"y","amount":2}]', 'not JSON']) {
  test(`JSON rejects malformed records: ${content.slice(0, 45)}`, async (t) => {
    const root = await fixture(t, content);
    await assert.rejects(loadDatasets([definition], root), /JSON|row|column|duplicate/i);
  });
}

test('dataset paths reject traversal, absolute paths and executable extensions', async (t) => {
  const root = await fixture(t, '[]');
  for (const file of ['data/../items.json', '../items.json', 'C:/items.json', '/items.json', 'data\\items.json', 'data/items.js']) {
    await assert.rejects(loadDatasets([{ ...definition, file }], root), /path|file/i);
  }
});

test('dataset files and ancestor directories cannot be symlinks', async (t) => {
  const root = await fixture(t, '[]');
  // Directory junctions work on Windows without the symlink creation privilege.
  await symlink(join(root, 'data'), join(root, 'data', 'linked'), 'junction');
  await assert.rejects(loadDatasets([{ ...definition, file: 'data/linked/items.json' }], root), /link/i);
  try { await symlink(join(root, 'data/items.json'), join(root, 'data/linked.json'), 'file'); }
  catch (err) {
    if (err.code !== 'EPERM') throw err;
    await symlink(join(root, 'data'), join(root, 'data/linked.json'), 'junction');
  }
  await assert.rejects(loadDatasets([{ ...definition, file: 'data/linked.json' }], root), /link/i);
});

test('JSON decimal tokens retain precision before JavaScript Number conversion', async (t) => {
  const root = await fixture(t, '[{"id":"a","group":"x","amount":90071992547409.91}]');
  const [data] = await loadDatasets([definition], root);
  assert.equal(data.rows[0].amount, '90071992547409.91');
  await writeFile(join(root, 'data/items.json'), '[{"id":"a","group":"x","amount":0.10000000000000001}]');
  await assert.rejects(loadDatasets([definition], root), /precision/i);
});

test('JSON numbers follow the same plain-decimal syntax as CSV numeric cells', async (t) => {
  const root = await fixture(t, '[{"id":"a","group":"x","amount":1e2}]');
  await assert.rejects(loadDatasets([definition], root), /decimal/i);
});

test('empty datasets are valid evidence and invalid UTF-8 is rejected', async (t) => {
  const root = await fixture(t, '[]');
  assert.equal((await loadDatasets([definition], root))[0].rows.length, 0);
  await writeFile(join(root, 'data/items.json'), Buffer.from([0xff]));
  await assert.rejects(loadDatasets([definition], root), /encoded|encoding/i);
});

test('file byte and row limits are enforced before returning a snapshot', async (t) => {
  const root = await fixture(t, ' '.repeat(DATASET_LIMITS.maxFileBytes + 1));
  await assert.rejects(loadDatasets([definition], root), /size|bytes/i);
  await writeFile(join(root, 'data/items.json'), JSON.stringify(Array.from({ length: DATASET_LIMITS.maxRows + 1 }, (_, i) => ({ id: String(i), group: 'x', amount: 1 }))));
  await assert.rejects(loadDatasets([definition], root), /rows/i);
});

test('dataset declaration rejects duplicate IDs/columns, missing ID column and invalid scale', async (t) => {
  const root = await fixture(t, '[]');
  for (const defs of [
    [definition, definition],
    [{ ...definition, id: '../items' }],
    [{ ...definition, columns: [...columns, columns[0]] }],
    [{ ...definition, id_column: 'missing' }],
    [{ ...definition, columns: [{ name: 'id', type: 'string', scale: 2 }] }],
    [{ ...definition, columns: [{ name: 'id', type: 'number', scale: 7 }] }],
    [{ ...definition, module: 'arbitrary.js' }],
    [JSON.parse(JSON.stringify(definition).replace(/}$/, ',"constructor":"untrusted"}'))],
  ]) await assert.rejects(loadDatasets(defs, root), /dataset|column|scale/i);
});
