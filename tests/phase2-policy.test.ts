import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { validatePath } from '../src/security/path-policy.js';
import { configureRuntimeSession } from '../src/runtime/session.js';

test('Phase 2 local .getitignore blocks matching reads and writes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'getit-policy-'));
  const pem = path.join(dir, 'secret.pem');
  fs.writeFileSync(path.join(dir, '.getitignore'), '*.pem\n', 'utf-8');
  fs.writeFileSync(pem, 'secret', 'utf-8');
  configureRuntimeSession({ policyProfile: 'normal' });
  const result = validatePath(pem, { cwd: dir });
  assert.strictEqual(result.allowed, false);
  assert.ok(result.reason?.includes('policy'));
});

test('Phase 2 override still blocks catastrophic paths', () => {
  configureRuntimeSession({ policyProfile: 'override' });
  const result = validatePath('/proc/cpuinfo', { cwd: process.cwd(), profile: 'override' });
  assert.strictEqual(result.allowed, false);
});
