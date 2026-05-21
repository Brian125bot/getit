import { spawn } from 'node:child_process';
import assert from 'node:assert';

// We run this test against the compiled dist/src/index.js or dist/index.js
// In tsconfig outDir is './dist', and rootDir is './', so files are in dist/src/... and dist/tests/...
// Let's spawn dist/src/index.js
const child = spawn('node', ['dist/src/index.js'], { env: { ...process.env, MOCK_TOOL_CALL: 'true' } });
let checked = false;

child.stdout.on('data', (data) => {
  const output = data.toString();
  if (output.includes('[Y/n/e]')) {
    child.stdin.write('n\n');
    checked = true;
  }
});

child.on('close', (code) => {
  assert.strictEqual(code, 0);
  assert.strictEqual(checked, true, "Interceptor must pause execution for user confirmation prompt.");
  console.log('✅ Stage 1 Test Passed: Interception and user rejection handled cleanly.');
});
