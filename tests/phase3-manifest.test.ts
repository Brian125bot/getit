import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initWorkspaceManifest, loadWorkspaceManifest, MANIFEST_FILENAME } from '../src/workspace/manifest.js';

test('Phase 3 Manifest: init writes metadata-only JSON (WKS_001)', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getit-manifest-meta-'));

  try {
    const secretContent = 'TOKEN=sk-abcdef123456789012345678901234567890\n';
    fs.writeFileSync(path.join(tempDir, '.env'), secretContent, 'utf-8');
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{"name":"x"}', 'utf-8');

    const manifest = await initWorkspaceManifest(tempDir);
    const raw = fs.readFileSync(path.join(tempDir, MANIFEST_FILENAME), 'utf-8');

    assert.ok(manifest.fingerprint.length > 0);
    assert.ok(manifest.trackedPaths['.env']);
    assert.ok(manifest.trackedPaths['package.json']);

    assert.ok(!raw.includes(secretContent));
    assert.ok(!raw.includes('sk-abcdef'));
    assert.ok(raw.includes('"hash"'));
    assert.ok(raw.includes('"mode"'));
    assert.ok(raw.includes('"mtime"'));

    const loaded = loadWorkspaceManifest(tempDir);
    assert.strictEqual(loaded.fingerprint, manifest.fingerprint);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Phase 3 Manifest: boundary traversal blocked outside workspace (WKS_002)', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getit-manifest-boundary-'));
  const outerFile = path.join(os.tmpdir(), `getit-forbidden-${Date.now()}.txt`);

  try {
    fs.writeFileSync(path.join(tempDir, MANIFEST_FILENAME), '{}', 'utf-8');
    fs.writeFileSync(outerFile, 'x', 'utf-8');

    const { validatePath } = await import('../src/security/path-policy.js');
    const { configureRuntimeSession } = await import('../src/runtime/session.js');
    configureRuntimeSession({ policyProfile: 'normal' });

    const inside = validatePath(path.join(tempDir, 'safe.txt'), { cwd: tempDir });
    const outside = validatePath(outerFile, { cwd: tempDir });

    fs.writeFileSync(path.join(tempDir, 'safe.txt'), 'ok', 'utf-8');
    assert.strictEqual(inside.allowed, true);
    assert.strictEqual(outside.allowed, false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (fs.existsSync(outerFile)) fs.rmSync(outerFile, { force: true });
  }
});
