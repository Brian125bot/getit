import test from 'node:test';
import assert from 'node:assert';
import { discoverEnvironment } from '../src/discovery/environment.js';
import { buildSystemPrompt } from '../src/agent/prompt.js';

test('Phase 2 environment includes package manager context', () => {
  const env = discoverEnvironment();
  assert.ok(env.primaryPackageManager);
  assert.ok(env.targetPlatform);
});

test('Phase 2 prompt mandates discovered package manager', () => {
  const prompt = buildSystemPrompt();
  assert.ok(prompt.includes('Primary Package Manager'));
  assert.ok(prompt.includes('system_environment'));
});
