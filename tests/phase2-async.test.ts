import test from 'node:test';
import assert from 'node:assert';
import { executeCommandAsync } from '../src/execution/async-process.js';
import { truncateForContext } from '../src/execution/log-buffer.js';

test('Phase 2 async process streams and captures output', async () => {
  const started = Date.now();
  const result = await executeCommandAsync('echo first; sleep 0.1; echo second', {
    cwd: process.cwd(),
    timeoutMs: 2000,
    displayOutput: false
  });
  assert.strictEqual(result.exitCode, 0);
  assert.ok(result.stdout.includes('first'));
  assert.ok(result.stdout.includes('second'));
  assert.ok(Date.now() - started >= 80);
});

test('Phase 2 log truncator preserves head and tail', () => {
  const text = Array.from({ length: 10000 }, (_, i) => `line-${i}`).join('\n');
  const truncated = truncateForContext(text);
  assert.ok(truncated.includes('line-0'));
  assert.ok(truncated.includes('line-9999'));
  assert.ok(truncated.includes('Dynamic Truncation'));
  assert.ok(truncated.length < text.length);
});
