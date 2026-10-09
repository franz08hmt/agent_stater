import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { ROOT } from './helpers.js';

const run = (...args) => spawnSync(process.execPath, ['scripts/rag-eval.js', ...args], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });

test('rag:eval --profile=mock runs the harness, labels it as wiring-only evidence and exits 0', () => {
  const r = run('--profile=mock', '--only=S01,S18,V01');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /NOT evidence about a real LLM or a real embedding model/);
  assert.match(r.stdout, /3 PASS, 0 FAIL, 0 REVIEW_REQUIRED, 0 BLOCKED, 0 NOT_RUN of 3 -> PASS/);
  assert.match(r.stdout, /real LLM requests 0; cloud requests 0/);
});

test('rag:eval refuses real requests without --live and validates its arguments (exit 2)', () => {
  for (const args of [[], ['--profile=ollama-qwen3'], ['--profile=mock', '--live'], ['--profile=mock', '--fake-embeddings'], ['--profile=mock', '--only=ZZ'], ['--profile=mock', '--repeat=9'], ['--bogus=1'], ['--profile=ollama-qwen3', '--live', '--max-embedding=25'], ['--profile=ollama-qwen3', '--live', '--max-generation=0']]) {
    const r = run(...args);
    assert.equal(r.status, 2, `${args.join(' ')} -> ${r.status}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /Usage: npm run rag:eval/);
  }
});
