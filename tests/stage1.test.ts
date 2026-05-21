import { spawn } from 'node:child_process';
import assert from 'node:assert';
import test from 'node:test';

test('Stage 1: mock interception path exits cleanly', async () => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('node', ['dist/src/index.js'], { env: { ...process.env, MOCK_TOOL_CALL: 'true' } });

    child.stdout.on('data', (data) => {
      const output = data.toString();
      if (output.includes('[Y/n/e]')) {
        child.stdin.write('n\n');
      }
    });

    child.on('error', reject);
    child.on('close', (code) => {
      try {
        assert.strictEqual(code, 0);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
});
