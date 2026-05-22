import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initWorkspaceManifest, loadWorkspaceManifest, MANIFEST_FILENAME } from '../src/workspace/manifest.js';
import { findWorkspaceRoot, isPathInWorkspace } from '../src/workspace/boundary.js';
import { validatePath } from '../src/security/path-policy.js';
import { configureRuntimeSession } from '../src/runtime/session.js';

test('Phase 3 Workspace: Manifest Initialization & Load', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getit-ws-'));
  try {
    // Write a mock candidate file to be tracked
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'test-project' }), 'utf-8');
    
    // Init manifest
    const manifest = await initWorkspaceManifest(tempDir);
    
    assert.ok(manifest.fingerprint);
    assert.strictEqual(manifest.platform, os.platform());
    assert.ok(manifest.trackedPaths['package.json']);
    assert.ok(fs.existsSync(path.join(tempDir, MANIFEST_FILENAME)));

    // Load manifest
    const loaded = loadWorkspaceManifest(tempDir);
    assert.strictEqual(loaded.fingerprint, manifest.fingerprint);
    assert.strictEqual(loaded.platform, manifest.platform);
    assert.strictEqual(loaded.trackedPaths['package.json'].hash, manifest.trackedPaths['package.json'].hash);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Phase 3 Workspace: Root climbing search', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getit-root-'));
  const subSubDir = path.join(tempDir, 'src', 'workspace');
  fs.mkdirSync(subSubDir, { recursive: true });
  
  try {
    // No manifest initially
    assert.strictEqual(findWorkspaceRoot(subSubDir), null);

    // Create manifest at tempDir root
    fs.writeFileSync(path.join(tempDir, MANIFEST_FILENAME), '{}', 'utf-8');
    
    // Should now find it by climbing up
    assert.strictEqual(findWorkspaceRoot(subSubDir), tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Phase 3 Workspace: Boundary traversal enforcement', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getit-boundary-'));
  const outerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getit-outer-'));
  
  try {
    // Path inside workspace root
    const innerPath = path.join(tempDir, 'src', 'main.ts');
    assert.strictEqual(isPathInWorkspace(innerPath, tempDir), true);
    assert.strictEqual(isPathInWorkspace(tempDir, tempDir), true);

    // Path outside workspace root
    const outerPath = path.join(outerDir, 'some-file.txt');
    assert.strictEqual(isPathInWorkspace(outerPath, tempDir), false);

    // Allowed dotfile in home (e.g. ~/.bashrc)
    const home = os.homedir();
    const bashrc = path.join(home, '.bashrc');
    // should allow direct dotfiles in home, unless they are in bannedPrefixes
    const isBashrcAllowed = isPathInWorkspace(bashrc, tempDir);
    // Since bashrc is a direct dotfile not in .ssh/.gnupg/.aws/.npm/.config, it might be allowed
    assert.strictEqual(isBashrcAllowed, true);

    // Banned dotfile directory (e.g. ~/.ssh/id_rsa)
    const idRsa = path.join(home, '.ssh', 'id_rsa');
    assert.strictEqual(isPathInWorkspace(idRsa, tempDir), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(outerDir, { recursive: true, force: true });
  }
});

test('Phase 3 Workspace: Path Policy Integration', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getit-policy-int-'));
  const outsideFile = path.join(os.tmpdir(), 'forbidden-file.txt');
  fs.writeFileSync(outsideFile, 'secret', 'utf-8');

  try {
    // Setup manifest so workspace is active
    fs.writeFileSync(path.join(tempDir, MANIFEST_FILENAME), '{}', 'utf-8');
    
    // Normal workspace path should be allowed
    const insideFile = path.join(tempDir, 'safe.txt');
    fs.writeFileSync(insideFile, 'hello', 'utf-8');

    configureRuntimeSession({ policyProfile: 'normal' });

    // Validate normal inside path
    const insideResult = validatePath(insideFile, { cwd: tempDir });
    assert.strictEqual(insideResult.allowed, true);

    // Validate path outside workspace (should be blocked due to active workspace manifest)
    const outsideResult = validatePath(outsideFile, { cwd: tempDir });
    assert.strictEqual(outsideResult.allowed, false);
    assert.ok(outsideResult.reason?.includes('lies outside the active workspace boundary'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(outsideFile, { recursive: true, force: true });
  }
});
