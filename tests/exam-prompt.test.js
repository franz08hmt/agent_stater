import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL, REPAIR_MESSAGE } from '../config/prompts.js';
import { harness, tool, final } from './helpers.js';

test('protocol requires retrieval before source-based answers and copying complete source IDs', () => {
  assert.match(PROTOCOL, /call an allowed read tool before/i);
  assert.match(PROTOCOL, /copy each source_id exactly/i);
  assert.match(PROTOCOL, /never invent/i);
});

test('citation repair with no evidence requests a permitted read, without inventing sources', async (t) => {
  const h = await harness({ replies: [final('401 authentication.', ['note-1234']), (messages) => {
    assert.match(messages.at(-1).content, /No evidence has been retrieved.*call a permitted read tool/i);
    return tool('search_notes', { query: '401 403' });
  }, final('401 authentication.', ['http-status'])] }); t.after(h.cleanup);
  const run = await h.run('Explain HTTP 401 using notes.');
  assert.equal(run.status, 'completed'); assert.equal(run.repairs_used, 1); assert.deepEqual(run.final.source_ids, ['http-status']);
});

test('citation repair lists only the current run sources, bounded independently of context', async (t) => {
  const h = await harness({ replies: [tool('search_notes', { query: '401 403' }), final('401 authentication.', ['invented']), (messages) => {
    assert.match(messages.at(-1).content, /Valid source IDs.*http-status/); assert.ok(!messages.at(-1).content.includes('rag-basics'));
    return final('401 authentication.', ['http-status']);
  }] }); t.after(h.cleanup);
  assert.equal((await h.run('Explain HTTP 401 using notes.')).status, 'completed');
  const message = REPAIR_MESSAGE(['bad citation'], false, Array.from({ length: 200 }, (_, i) => `source-${i}-${'x'.repeat(80)}`));
  assert.ok(message.length < 1600); assert.match(message, /Additional IDs remain in observations/);
});
