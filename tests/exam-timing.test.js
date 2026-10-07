import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvironment } from '../src/operations/context.js';
import { beginTiming, markTiming, readTiming, TIMING_STEPS } from '../src/operations/timing.js';

test('rehearsal timer records ordered manual steps and does not claim scripted time is student time', async (t) => {
  const env = await loadEnvironment({ dotenv: false }); env.root = await mkdtemp(join(tmpdir(), 'agent-timing-test-'));
  t.after(() => rm(env.root, { recursive: true, force: true }));
  const record = await beginTiming(env, { taskId: 'rehearsal-tickets', actor: 'agent', now: 1000 });
  await assert.rejects(markTiming(env, record.timing_id, { step: 'map', event: 'start' }), /order/);
  let time = 1000;
  for (const step of TIMING_STEPS) {
    await markTiming(env, record.timing_id, { step, event: 'start', now: time });
    await markTiming(env, record.timing_id, { step, event: 'end', now: time + 100, note: 'manual edit: config; no errors' }); time += 200;
  }
  const done = await readTiming(env, record.timing_id);
  assert.equal(done.status, 'REVIEW_REQUIRED'); assert.equal(done.total_ms, 1100);
  assert.equal(done.student_adaptation.status, 'NOT_RUN'); assert.equal(done.actor, 'agent');
  assert.equal(done.steps[2].elapsed_ms, 100); assert.match(done.steps[2].note, /manual edit/);
  await assert.rejects(markTiming(env, record.timing_id, { step: 'demo', event: 'end' }), /finished/);
  await assert.rejects(readTiming(env, '../outside'));
  await assert.rejects(beginTiming(env, { taskId: '../config' }));
});

test('student self-recorded time remains review required and identifies stale configuration', async (t) => {
  const env = await loadEnvironment({ dotenv: false }); env.root = await mkdtemp(join(tmpdir(), 'agent-timing-test-'));
  t.after(() => rm(env.root, { recursive: true, force: true }));
  const record = await beginTiming(env, { taskId: 'rehearsal-rooms', actor: 'student' });
  const reading = await readTiming(env, record.timing_id); assert.equal(reading.status, 'NOT_RUN');
  env.service.configuration_id = 'changed'; assert.equal((await readTiming(env, record.timing_id)).stale, true);
  await assert.rejects(markTiming(env, record.timing_id, { step: 'read', event: 'start', note: 'x'.repeat(501) }));
});
