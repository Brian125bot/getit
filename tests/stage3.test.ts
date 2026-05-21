import { spawn } from 'node:child_process';
import assert from 'node:assert';

// Spawn the main dist/index.js which redirects to dist/src/index.js
// Spawn with a mock API key to bypass the setup wizard
const child = spawn('node', ['dist/index.js'], {
  env: { ...process.env, OPENROUTER_API_KEY: 'sk-test-mock-key', GETIT_TEST_MODE: 'true' }
});
let buffer = '';

child.stdout.on('data', (data) => {
  const chunk = data.toString();
  buffer += chunk;
  
  if (buffer.includes('getit-agent ❯ ') && !buffer.includes('State cached')) {
    child.stdin.write('Remember token "TEST_KEY_VALID"\n');
  } else if (buffer.includes('getit-agent ❯ ') && buffer.includes('State cached')) {
    child.stdin.write('Recall the token name.\n');
  }
});

child.on('close', (code) => {
  assert.strictEqual(code, 0);
  assert(buffer.includes('TEST_KEY_VALID'), "REPL must maintain context and memory history statefully over multiple turns.");
  console.log('✅ Stage 3 Test Passed: Multi-turn interaction context preserved.');
});
