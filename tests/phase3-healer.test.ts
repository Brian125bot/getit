import test from 'node:test';
import assert from 'node:assert';
import { attemptDependencyHealing } from '../src/workspace/healer.js';

test('Phase 3 Healer: Match Command Not Found', () => {
  const stderr = 'bash: curl: command not found';
  const result = attemptDependencyHealing(stderr);
  
  assert.strictEqual(result.matched, true);
  assert.ok(result.command?.includes('curl'));
  assert.ok(result.description?.includes('missing from the system path'));
});

test('Phase 3 Healer: Match Command Not Found Alt Format', () => {
  const stderr = 'docker: command not found';
  const result = attemptDependencyHealing(stderr);
  
  assert.strictEqual(result.matched, true);
  assert.ok(result.command?.includes('docker'));
});

test('Phase 3 Healer: Match Missing Shared Library', () => {
  const stderr = 'error while loading shared libraries: libssl.so.1.1: cannot open shared object file: No such file or directory';
  const result = attemptDependencyHealing(stderr);

  assert.strictEqual(result.matched, true);
  // Should resolve libssl to libssl-dev package name
  assert.ok(result.command?.includes('libssl-dev'));
  assert.ok(result.description?.includes('dynamic shared library'));
});

test('Phase 3 Healer: Match Missing Python Package', () => {
  const stderr = 'ModuleNotFoundError: No module named \'requests\'';
  const result = attemptDependencyHealing(stderr);

  assert.strictEqual(result.matched, true);
  assert.strictEqual(result.command, 'pip install requests');
  assert.ok(result.description?.includes('Python dependency/module'));
});

test('Phase 3 Healer: Match Missing Node Module', () => {
  const stderr = 'Error: Cannot find module \'typescript\'';
  const result = attemptDependencyHealing(stderr);

  assert.strictEqual(result.matched, true);
  assert.ok(result.command?.includes('typescript'));
  assert.ok(result.description?.includes('Node.js package/module'));
});

test('Phase 3 Healer: Safe non-match on normal errors', () => {
  const stderr = 'error: invalid option --foo';
  const result = attemptDependencyHealing(stderr);

  assert.strictEqual(result.matched, false);
  assert.strictEqual(result.command, undefined);
});
