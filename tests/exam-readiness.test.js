import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEnvironment } from '../src/operations/context.js';
import { saveReport } from '../src/operations/reports.js';
import { assessReadiness } from '../src/operations/readiness.js';

test('readiness distinguishes configured, probe/warm, live failures, stale and unmeasured student time', async (t) => {
  const env = await loadEnvironment({ dotenv: false }); env.root = await mkdtemp(join(tmpdir(), 'agent-readiness-test-'));
  t.after(() => rm(env.root, { recursive: true, force: true }));
  const server = { state: 'running', configuration_matches: true, url: 'http://127.0.0.1:8787' };
  const initial = await assessReadiness(env, { profileId: 'ollama-qwen3', server });
  assert.equal(initial.model.name, 'qwen3:8b');
  assert.equal(initial.model.configured, true); assert.equal(initial.model.probed.status, 'NOT_RUN'); assert.equal(initial.status, 'REVIEW_REQUIRED');
  await saveReport(env, 'probe', { status: 'PASS', model_profile_id: 'ollama-qwen3', result: { protocol_ok: true, metrics: { provider_requests: 1 } } });
  await saveReport(env, 'smoke', { status: 'FAIL', model_evidence: 'LIVE', model_profile_id: 'ollama-qwen3',
    results: [{ id: 'notes', trial: 1, status: 'FAIL' }, ...[1, 2, 3].map((trial) => ({ id: 'sum', trial, status: 'PASS' }))] });
  const checked = await assessReadiness(env, { profileId: 'ollama-qwen3', server });
  assert.equal(checked.status, 'FAIL'); assert.equal(checked.model.probed.status, 'PASS');
  assert.equal(checked.live_cases.sum.status, 'PASS'); assert.equal(checked.live_cases.notes.status, 'FAIL');
  assert.equal(checked.student_adaptation.status, 'NOT_RUN');
  env.service.configuration_id = 'changed'; const stale = await assessReadiness(env, { profileId: 'ollama-qwen3', server });
  assert.equal(stale.model.probed.status, 'NOT_RUN'); assert.equal(stale.live_cases.sum.status, 'NOT_RUN'); assert.ok(stale.reports.every((r) => r.stale));
  const occupied = await assessReadiness(env, { profileId: 'ollama-qwen3', server: { state: 'occupied' } });
  assert.equal(occupied.status, 'BLOCKED');
});

test('a successful mock probe and scripted suite never count as live model verification', async (t) => {
  const env = await loadEnvironment({ dotenv: false }); env.root = await mkdtemp(join(tmpdir(), 'agent-readiness-test-'));
  t.after(() => rm(env.root, { recursive: true, force: true }));
  await saveReport(env, 'probe', { status: 'PASS', model_profile_id: 'mock', result: { is_mock: true, protocol_ok: true } });
  await saveReport(env, 'smoke', { status: 'PASS', model_profile_id: 'mock', model_evidence: 'SCRIPTED_BACKEND_ONLY', results: [] });
  const checked = await assessReadiness(env, { profileId: 'mock', server: { state: 'running', configuration_matches: true } });
  assert.equal(checked.model.connection_verified, false); assert.equal(checked.model.probed.label, 'mock simulation');
  assert.equal(checked.live_cases.notes.status, 'NOT_RUN'); assert.equal(checked.offline.smoke.status, 'PASS');
});
