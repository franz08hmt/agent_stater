// Bounded, startup-only snapshots. No model-supplied path ever reaches the filesystem.
import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validate } from '../tools/schema.js';

export const DATASET_LIMITS = Object.freeze({ maxFileBytes: 128 * 1024, maxRows: 200, maxResultChars: 1500 });
const name = { type: 'string', maxLength: 40, pattern: '^[a-z][a-z0-9_]*$' };
export const datasetsSchema = {
  type: 'array', maxItems: 6, items: {
    type: 'object', additionalProperties: false, required: ['id', 'file', 'id_column', 'columns'],
    properties: {
      id: { type: 'string', maxLength: 40, pattern: '^[a-z][a-z0-9-]*$' },
      file: { type: 'string', minLength: 6, maxLength: 160 }, id_column: name,
      columns: { type: 'array', minItems: 1, maxItems: 16, items: {
        type: 'object', additionalProperties: false, required: ['name', 'type'],
        properties: { name, type: { type: 'string', enum: ['string', 'number'] }, scale: { type: 'integer', minimum: 0, maximum: 6 } },
      } },
    },
  },
};

// Exact base-10 fixed point; never Number(''), floating addition or implicit rounding.
export function decimalUnits(value, scale = 0) {
  if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'number' && !Number.isFinite(value))) {
    throw new Error('expected a finite decimal number or decimal string');
  }
  const token = String(value);
  if (token.length > 32 || !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(token)) throw new Error('invalid decimal number');
  const [whole, fraction = ''] = token.replace(/^-/, '').split('.');
  if (fraction.length > scale) throw new Error(`decimal precision exceeds scale ${scale}; rounding is not allowed`);
  const units = BigInt(whole + fraction.padEnd(scale, '0')) * (token.startsWith('-') ? -1n : 1n);
  if (units > BigInt(Number.MAX_SAFE_INTEGER) || units < -BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('decimal number exceeds safe scaled range');
  return units;
}

// The reviver source context (Node >=22.12) keeps the original decimal spelling,
// before JSON.parse's Number loses significant digits. A class keeps real strings
// distinct, so a JSON number cannot masquerade as a declared string column.
class JsonNumberToken {
  constructor(source) { this.source = source; }
}

export function formatUnits(units, scale = 0) {
  const digits = (units < 0n ? -units : units).toString().padStart(scale + 1, '0');
  return (units < 0n ? '-' : '') + (scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits);
}

function parseCsv(text) {
  const records = [];
  let row = [], cell = '', state = 'start';
  const finishCell = () => { row.push(cell); cell = ''; state = 'start'; };
  const finishRow = () => { finishCell(); records.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (state === 'quoted') {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else state = 'closed';
      } else cell += ch;
    } else if (ch === ',' || ch === '\n' || ch === '\r') {
      if (ch === ',') finishCell();
      else {
        if (ch === '\r') {
          if (text[i + 1] !== '\n') throw new Error('CSV: bare CR outside a quoted cell');
          i++;
        }
        finishRow();
      }
    } else if (ch === '"' && state === 'start') state = 'quoted';
    else {
      if (ch === '"' || state === 'closed') throw new Error(`CSV: unexpected character at offset ${i}`);
      cell += ch; state = 'plain';
    }
  }
  if (state === 'quoted') throw new Error('CSV: unclosed quoted cell');
  if (row.length || cell || state !== 'start') finishRow();
  return records;
}

async function readDataset(root, file) {
  if (!/^data\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:json|csv)$/.test(file)) {
    throw new Error('file path must be a JSON/CSV file under data/ without traversal');
  }
  let path = resolve(root);
  const parts = file.split('/');
  let info;
  for (let i = 0; i < parts.length; i++) {
    path = join(path, parts[i]);
    info = await lstat(path).catch(() => { throw new Error(`file does not exist: ${file}`); });
    if (info.isSymbolicLink()) throw new Error('file path contains a symlink');
    if (i < parts.length - 1 ? !info.isDirectory() : !info.isFile()) throw new Error('file path must use real directories and a regular file');
  }
  if (info.size > DATASET_LIMITS.maxFileBytes) throw new Error(`file exceeds ${DATASET_LIMITS.maxFileBytes} bytes`);
  // Reject path aliases and replacement between lstat/open. The read itself is bounded too.
  if (await realpath(path) !== join(await realpath(root), ...parts)) throw new Error('file path resolved through a link');
  const handle = await open(path, 'r');
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.ino !== info.ino || opened.dev !== info.dev) throw new Error('file changed while loading dataset');
    const buffer = Buffer.alloc(DATASET_LIMITS.maxFileBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > DATASET_LIMITS.maxFileBytes) throw new Error(`file exceeds ${DATASET_LIMITS.maxFileBytes} bytes`);
    const bytes = buffer.subarray(0, size);
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''), bytes };
  } finally { await handle.close(); }
}

export async function loadDatasets(definitions = [], root) {
  const errors = validate(datasetsSchema, definitions);
  if (errors.length) throw new Error(`Invalid datasets: ${errors.join('; ')}`);
  const ids = new Set();
  const snapshots = [];
  for (const def of definitions) {
    try {
      if (ids.has(def.id)) throw new Error('duplicate dataset ID');
      ids.add(def.id);
      const names = def.columns.map((c) => c.name);
      if (new Set(names).size !== names.length) throw new Error('duplicate column names');
      if (!def.columns.some((c) => c.name === def.id_column && c.type === 'string')) throw new Error('id_column must name a string column');
      if (def.columns.some((c) => c.type === 'string' && c.scale !== undefined)) throw new Error('scale is only allowed on number columns');
      const { text, bytes } = await readDataset(root, def.file);
      let raw;
      if (def.file.endsWith('.json')) {
        try {
          raw = JSON.parse(text, (_key, value, context) => {
            if (typeof value !== 'number') return value;
            if (typeof context?.source !== 'string') throw new Error('runtime must support JSON numeric source context');
            return new JsonNumberToken(context.source);
          });
        } catch (e) { throw new Error(`JSON parse error: ${e.message}`); }
      } else {
        const [header, ...records] = parseCsv(text);
        if (!header || header.length !== names.length || new Set(header).size !== header.length || header.some((h) => !names.includes(h))) {
          throw new Error('CSV header must contain every declared column exactly once');
        }
        raw = records.map((cells, i) => {
          if (cells.length !== header.length) throw new Error(`CSV row ${i + 1}: wrong column count`);
          return Object.fromEntries(header.map((h, j) => [h, cells[j]]));
        });
      }
      if (!Array.isArray(raw)) throw new Error('JSON dataset must be an array of rows');
      if (raw.length > DATASET_LIMITS.maxRows) throw new Error(`dataset exceeds ${DATASET_LIMITS.maxRows} rows`);
      const recordIds = new Set();
      const rows = raw.map((row, i) => {
        if (!row || Array.isArray(row) || typeof row !== 'object' || Object.keys(row).length !== names.length || names.some((n) => !Object.hasOwn(row, n))) {
          throw new Error(`row ${i + 1}: columns must exactly match declaration`);
        }
        const normalized = {};
        for (const col of def.columns) {
          try {
            const value = row[col.name];
            if (col.type === 'number') normalized[col.name] = formatUnits(decimalUnits(value instanceof JsonNumberToken ? value.source : value, col.scale), col.scale);
            else {
              if (typeof value !== 'string' || value.length > 500) throw new Error('expected string of at most 500 characters');
              normalized[col.name] = value;
            }
          } catch (e) { throw new Error(`row ${i + 1}, column ${col.name}: ${e.message}`); }
        }
        const id = normalized[def.id_column];
        if (!id.trim() || recordIds.has(id)) throw new Error(`row ${i + 1}: blank or duplicate record ID`);
        recordIds.add(id);
        return Object.freeze(normalized);
      });
      snapshots.push(Object.freeze({
        id: def.id, idColumn: def.id_column,
        columns: Object.freeze(def.columns.map((c) => Object.freeze({ ...c }))), rows: Object.freeze(rows),
        version: createHash('sha256').update(JSON.stringify(def)).update(bytes).digest('hex'),
      }));
    } catch (e) { throw new Error(`Invalid dataset ${def.id}: ${e.message}`); }
  }
  return Object.freeze(snapshots);
}
