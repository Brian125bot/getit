import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initWorkspaceManifest, saveWorkspaceManifest, loadWorkspaceManifest } from '../src/workspace/manifest.js';
import { detectWorkspaceDrift } from '../src/workspace/drift.js';

test('Phase 3 Drift: Detect unmodified, modified, missing, and untracked drift', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getit-drift-'));
  try {
    // 1. Setup tracked files
    const packageJsonPath = path.join(tempDir, 'package.json');
    const envPath = path.join(tempDir, '.env');
    
    fs.writeFileSync(packageJsonPath, JSON.stringify({ name: 'my-app' }), 'utf-8');
    fs.writeFileSync(envPath, 'PORT=8080\nAPI_KEY=sk-testsecretkey1234567890123456789\n', 'utf-8');

    // 2. Initialize the manifest
    const manifest = await initWorkspaceManifest(tempDir);
    assert.ok(manifest.trackedPaths['package.json']);
    assert.ok(manifest.trackedPaths['.env']);

    // Baseline: No drift should be detected immediately after init
    let drift = await detectWorkspaceDrift(tempDir);
    assert.strictEqual(drift.hasDrift, false);
    
    const pkgStatus = drift.files.find(f => f.path === 'package.json');
    const envStatus = drift.files.find(f => f.path === '.env');
    assert.strictEqual(pkgStatus?.status, 'unmodified');
    assert.strictEqual(envStatus?.status, 'unmodified');

    // 3. Trigger 'modified' drift
    // Change package.json slightly
    fs.writeFileSync(packageJsonPath, JSON.stringify({ name: 'my-app-changed' }), 'utf-8');
    
    drift = await detectWorkspaceDrift(tempDir);
    assert.strictEqual(drift.hasDrift, true);
    assert.strictEqual(drift.files.find(f => f.path === 'package.json')?.status, 'modified');

    // 4. Trigger 'missing' drift
    // Delete .env
    fs.unlinkSync(envPath);
    
    drift = await detectWorkspaceDrift(tempDir);
    assert.strictEqual(drift.hasDrift, true);
    assert.strictEqual(drift.files.find(f => f.path === '.env')?.status, 'missing');

    // 5. Trigger 'untracked' drift
    // Create a new untracked config candidate file: .getitignore
    const getitignorePath = path.join(tempDir, '.getitignore');
    fs.writeFileSync(getitignorePath, '*.log\n', 'utf-8');

    drift = await detectWorkspaceDrift(tempDir);
    assert.strictEqual(drift.hasDrift, true);
    assert.strictEqual(drift.files.find(f => f.path === '.getitignore')?.status, 'untracked');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Phase 3 Drift: Verify secret-scrubbed hash stability', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getit-drift-secret-'));
  try {
    const envPath = path.join(tempDir, '.env');
    // Save file with a specific API key
    fs.writeFileSync(envPath, 'SECRET=sk-FIRSTKEY12345678901234567890\n', 'utf-8');

    // Init manifest
    await initWorkspaceManifest(tempDir);

    // Modify the API key in .env (different value but same scrubbed pattern)
    fs.writeFileSync(envPath, 'SECRET=sk-SECONDKEY9876543210987654321\n', 'utf-8');

    // Drift check should treat it as 'unmodified' because both keys scrub to the same redacted signature!
    const drift = await detectWorkspaceDrift(tempDir);
    const envStatus = drift.files.find(f => f.path === '.env');
    assert.strictEqual(envStatus?.status, 'unmodified');
    assert.strictEqual(drift.hasDrift, false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
