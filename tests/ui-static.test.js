import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sunriseFixture } from './rag-helpers.js';
import { ROOT } from './helpers.js';

// The static server only serves an explicit allow-list. A module imported by the page but missing from it
// fails silently in the browser (the whole UI stays on "Checking model…"), so every import is fetched.
test('every browser module imported by the page is served by the backend', async (t) => {
  const base = await (await sunriseFixture(t)).serve();
  const files = (await readdir(join(ROOT, 'public'))).filter((f) => f.endsWith('.js'));
  const wanted = new Set(['app.js']);
  for (const file of files) for (const m of (await readFile(join(ROOT, 'public', file), 'utf8')).matchAll(/from '\.\/([\w-]+\.js)'/g)) wanted.add(m[1]);
  assert.ok(wanted.has('retrieval-view.js'));
  for (const file of wanted) {
    const res = await fetch(`${base}/${file}`);
    assert.equal(res.status, 200, `/${file}`);
    assert.match(res.headers.get('content-type'), /javascript/);
    assert.equal(await res.text(), await readFile(join(ROOT, 'public', file), 'utf8'));
  }
});
