// Markdown section chunker (deterministic, no I/O).
//
// One chunk per "## N. Title" section while the section fits in `max_chars`. A longer
// section is split on structural boundaries (blank-line blocks, then table rows with the
// header repeated, list items, sentences) and only as a last resort on whitespace.
// Consecutive chunks of ONE split section share ~`overlap_chars` of context; chunks of
// different sections never overlap. All sizes are CHARACTERS (UTF-16 code units of the
// normalised text), not tokens: a token count would depend on a model's tokenizer.

import { createHash } from 'node:crypto';

// Bump when the splitting rules change. Indexes record it, and readiness also re-chunks the
// current KB and compares, so a changed chunker can never silently reuse an old index.
export const CHUNKER_VERSION = 'markdown-section-v1';
export const DEFAULT_CHUNKING = Object.freeze({ max_chars: 1200, overlap_chars: 100 });

const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

/** CRLF and CR become LF, so a Windows checkout and a Unix checkout index identically. */
export const normalizeKb = (text) => String(text).replace(/\r\n?/g, '\n');
export const kbChecksum = (text) => sha256(normalizeKb(text));

export function documentIdFromFileName(fileName) {
  const base = String(fileName).replace(/\.[^.]+$/, '').split('_')[0];
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'kb';
}

const isTableLine = (line) => /^\s*\|/.test(line);
const isItemLine = (line) => /^\s*(?:[-*]|\d+\.)\s+/.test(line);

/** Blank-line separated blocks; a lead-in ending in ":" stays glued to the block after it. */
function toUnits(body) {
  const blocks = [];
  let current = [];
  for (const line of body.split('\n')) {
    if (line.trim() === '') { if (current.length) blocks.push(current); current = []; } else current.push(line);
  }
  if (current.length) blocks.push(current);
  const units = [];
  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i];
    const lead = lines.length === 1 && lines[0].trimEnd().endsWith(':') && i + 1 < blocks.length;
    if (lead) { units.push({ lines: [...lines, ...blocks[i + 1]], leadIn: lines[0] }); i += 1; } else units.push({ lines, leadIn: null });
  }
  return units.map((u) => ({ ...u, text: u.lines.join('\n'), kind: u.lines.every(isTableLine) ? 'table' : u.lines.some(isItemLine) ? 'list' : 'paragraph' }));
}

/** Cut at a word boundary: never in the middle of a word, never longer than `limit`. */
function hardSplit(text, limit) {
  const pieces = [];
  let rest = text.trim();
  while (rest.length > limit) {
    let cut = rest.lastIndexOf(' ', limit);
    if (cut < limit / 2) cut = limit; // a single enormous token has no whitespace to cut at
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

function packParts(parts, limit, joiner, prefix = '') {
  const out = [];
  let current = prefix;
  let has = false;
  for (const part of parts) {
    const candidate = has ? `${current}${joiner}${part}` : `${current}${part}`;
    if (candidate.length <= limit || !has) { current = candidate; has = true; } else { out.push(current); current = `${prefix}${part}`; }
  }
  if (has) out.push(current);
  return out;
}

/** Split one unit that is longer than `limit`. */
function splitUnit(unit, limit) {
  if (unit.kind === 'table') {
    const hasSeparator = unit.lines.length > 1 && /^\s*\|?[\s:|-]+\|?\s*$/.test(unit.lines[1]);
    const header = hasSeparator ? unit.lines.slice(0, 2) : unit.lines.slice(0, 1);
    const rows = unit.lines.slice(header.length);
    const prefix = `${header.join('\n')}\n`;
    return packParts(rows, limit, '\n', prefix).map((text) => ({ text, kind: 'table-part' }));
  }
  if (unit.kind === 'list') {
    const lead = unit.leadIn ? `${unit.leadIn}\n` : '';
    const lines = unit.leadIn ? unit.lines.slice(1) : unit.lines;
    const items = [];
    for (const line of lines) { if (isItemLine(line) || !items.length) items.push(line); else items[items.length - 1] += `\n${line}`; }
    const parts = items.flatMap((item) => (lead.length + item.length <= limit ? [item] : hardSplit(item, limit - lead.length)));
    return packParts(parts, limit, '\n', lead).map((text) => ({ text, kind: 'list-part' }));
  }
  const sentences = unit.text.split(/(?<=[.!?])\s+/).flatMap((s) => (s.length <= limit ? [s] : hardSplit(s, limit)));
  return packParts(sentences, limit, ' ').map((text) => ({ text, kind: 'text-part' }));
}

/** Last ~`size` characters of `text`, starting on a word boundary. */
function tail(text, size) {
  if (size <= 0 || text.length <= size) return size <= 0 ? '' : text;
  const slice = text.slice(text.length - size);
  const space = slice.search(/\s/);
  return (space >= 0 ? slice.slice(space + 1) : slice).trim();
}

function parseSections(text) {
  const lines = text.split('\n');
  let title = '';
  const sections = [];
  let current = null;
  let ordinal = 0;
  lines.forEach((line, index) => {
    const h1 = /^#\s+(.+?)\s*$/.exec(line);
    const h2 = /^##\s+(?:(\d+)\.\s*)?(.+?)\s*$/.exec(line);
    if (h1 && !title && !current) { title = h1[1]; return; }
    if (h2) {
      ordinal += 1;
      current = { number: h2[1] ? Number(h2[1]) : ordinal, title: h2[2], startLine: index + 1, bodyLines: [], endLine: index + 1 };
      sections.push(current);
      return;
    }
    if (current) { current.bodyLines.push(line); if (line.trim() !== '') current.endLine = index + 1; }
  });
  return { title, sections: sections.map((s) => ({ ...s, body: s.bodyLines.join('\n').trim() })).filter((s) => s.body) };
}

/**
 * @param {string} rawText the KB markdown
 * @param {{fileName:string, maxChars?:number, overlapChars?:number}} options
 */
export function chunkMarkdown(rawText, { fileName, maxChars = DEFAULT_CHUNKING.max_chars, overlapChars = DEFAULT_CHUNKING.overlap_chars }) {
  if (!Number.isInteger(maxChars) || maxChars < 200 || maxChars > 8000) throw new Error('max_chars must be an integer between 200 and 8000.');
  if (!Number.isInteger(overlapChars) || overlapChars < 0 || overlapChars > maxChars / 4) throw new Error('overlap_chars must be an integer between 0 and a quarter of max_chars.');
  const text = normalizeKb(rawText);
  const documentId = documentIdFromFileName(fileName);
  const { title, sections } = parseSections(text);
  if (!sections.length) throw new Error('The knowledge base has no "## " sections to chunk.');
  const seen = new Set();
  const chunks = [];
  for (const section of sections) {
    if (seen.has(section.number)) throw new Error(`Duplicate section number ${section.number}.`);
    seen.add(section.number);
    let pieces;
    if (section.body.length <= maxChars) pieces = [{ text: section.body, kind: 'whole' }];
    else {
      const limit = maxChars - overlapChars; // room for the overlap prefix that continuation chunks receive
      const parts = toUnits(section.body).flatMap((unit) => (unit.text.length <= limit ? [{ text: unit.text, kind: unit.kind }] : splitUnit(unit, limit)));
      pieces = [];
      let open = null; // the last piece, while it may still absorb whole blocks
      for (const part of parts) {
        const isSplitPart = part.kind.endsWith('-part');
        if (!isSplitPart && open && `${open.text}\n\n${part.text}`.length <= limit) { open.text += `\n\n${part.text}`; continue; }
        const piece = { text: part.text, kind: part.kind };
        pieces.push(piece);
        open = isSplitPart ? null : piece;
      }
    }
    pieces.forEach((piece, i) => {
      let body = piece.text;
      let overlap = 0;
      if (i > 0 && overlapChars > 0 && piece.kind !== 'table-part') {
        const carried = tail(pieces[i - 1].text, overlapChars);
        if (carried && !body.startsWith(carried)) { body = `${carried}\n\n${body}`; overlap = carried.length; }
      }
      chunks.push({
        source_id: `${documentId}-s${String(section.number).padStart(2, '0')}-c${i + 1}`,
        document_id: documentId, document_title: title, section_number: section.number, section_title: section.title,
        section_label: `${section.number}. ${section.title}`, chunk_number: i + 1, chunk_count: pieces.length,
        section_lines: [section.startLine, section.endLine], overlap_chars: overlap,
        text: body, text_sha256: sha256(body),
      });
    });
  }
  const ids = chunks.map((c) => c.source_id);
  if (new Set(ids).size !== ids.length || ids.some((id) => id.length > 60 || !/^[a-z0-9-]+$/.test(id))) throw new Error('Chunk source IDs must be unique, lowercase, and at most 60 characters.');
  return { document: { id: documentId, title }, chunker_version: CHUNKER_VERSION, chunks };
}
