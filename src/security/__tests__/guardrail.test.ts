import * as assert from 'node:assert';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { test, describe, before, after, beforeEach } from 'node:test';
import { loadPolicy, validateWorkspaceFile, clearPolicyCache } from '../guardrail-engine.js';

describe('Architectural Guardrails', () => {
  let tempDir: string;

  before(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'getit-guardrail-test-'));
    await fsp.mkdir(path.join(tempDir, '.getit'), { recursive: true });
  });

  after(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    clearPolicyCache();
  });

  test('loadPolicy returns disabled if file is missing', async () => {
    const policy = await loadPolicy(tempDir);
    assert.strictEqual(policy.enabled, false);
    assert.strictEqual(policy.rules.length, 0);
  });

  test('loadPolicy returns fail-closed block if JSON is corrupted', async () => {
    const policyPath = path.join(tempDir, '.getit', 'policy.json');
    await fsp.writeFile(policyPath, '{ "enabled": true, rules: [ "missing quotes" ] }');

    const policy = await loadPolicy(tempDir);
    assert.strictEqual(policy.enabled, true);
    assert.strictEqual(policy.rules[0].id, 'policy-corruption');
    assert.strictEqual(policy.rules[0].severity, 'block');
  });

  test('validateWorkspaceFile detects forbidden patterns', async () => {
    const policyPath = path.join(tempDir, '.getit', 'policy.json');
    const policy = {
      enabled: true,
      rules: [{
        id: 'no-raw-sql',
        description: 'No raw SQL queries',
        severity: 'block',
        targetPaths: ['src/services/**/*'],
        forbiddenPatterns: ['db\\.query\\('],
        remediationHint: 'Use query builder'
      }]
    };
    await fsp.writeFile(policyPath, JSON.stringify(policy));

    const serviceDir = path.join(tempDir, 'src', 'services');
    await fsp.mkdir(serviceDir, { recursive: true });
    const serviceFile = path.join(serviceDir, 'user-service.ts');
    await fsp.writeFile(serviceFile, 'const users = await db.query("SELECT * FROM users");');

    const violations = await validateWorkspaceFile(serviceFile, tempDir);
    assert.strictEqual(violations.length, 1);
    assert.strictEqual(violations[0].ruleId, 'no-raw-sql');
    assert.strictEqual(violations[0].line, 1);
  });

  test('allowedPatterns override forbiddenPatterns', async () => {
    const policyPath = path.join(tempDir, '.getit', 'policy.json');
    const policy = {
      enabled: true,
      rules: [{
        id: 'no-todo',
        description: 'No TODO comments',
        severity: 'warn',
        targetPaths: ['**/*.ts'],
        forbiddenPatterns: ['TODO'],
        allowedPatterns: ['TODO: ALLOWED'],
        remediationHint: 'Remove TODO'
      }]
    };
    await fsp.writeFile(policyPath, JSON.stringify(policy));

    const testFile = path.join(tempDir, 'test.ts');
    await fsp.writeFile(testFile, '// TODO: fix this\n// TODO: ALLOWED ignore this');

    const violations = await validateWorkspaceFile(testFile, tempDir);
    assert.strictEqual(violations.length, 1);
    assert.strictEqual(violations[0].line, 1);
  });
});
