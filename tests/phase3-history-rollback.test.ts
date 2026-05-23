import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { getTrackingRoot, stageToTracking } from '../src/workspace/tracking.js';
import { initWorkspaceManifest, loadWorkspaceManifest } from '../src/workspace/manifest.js';
import { WorkspaceHistoryManager } from '../src/workspace/history.js';
import { WorkspaceRollbackManager } from '../src/workspace/rollback.js';
import { findWorkspaceRoot } from '../src/workspace/boundary.js';

test('Phase 3: Workspace Shadow History Explorer Parsing & Rendering', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getit-history-test-'));
  const trackingBase = path.join(tempDir, 'tracking-base');
  fs.mkdirSync(trackingBase, { recursive: true });

  const originalBackupRoot = process.env.GETIT_BACKUP_ROOT;
  const originalTestMode = process.env.GETIT_TEST_MODE;
  
  process.env.GETIT_BACKUP_ROOT = trackingBase;
  process.env.GETIT_TEST_MODE = 'true';

  try {
    const trackingRoot = await getTrackingRoot();
    assert.ok(fs.existsSync(trackingRoot));

    // Initially, there should be no commits/history
    const initialHistory = await WorkspaceHistoryManager.getHistory();
    assert.strictEqual(initialHistory.length, 0);

    // Create a mock tracking file and commit it
    const testFile = path.join(trackingRoot, 'config.json');
    fs.writeFileSync(testFile, '{"key": "val"}', 'utf-8');
    
    execSync('git add config.json', { cwd: trackingRoot, stdio: 'ignore' });
    execSync('git commit -m "Initial commit test"', { cwd: trackingRoot, stdio: 'ignore' });

    const history = await WorkspaceHistoryManager.getHistory();
    assert.strictEqual(history.length, 1);
    assert.strictEqual(history[0].message, 'Initial commit test');
    assert.ok(history[0].hash.length > 0);

    // Check rendering
    const card = WorkspaceHistoryManager.renderHistory(history);
    assert.ok(card.includes('WORKSPACE SHADOW HISTORY'));
    assert.ok(card.includes('['));
    assert.ok(card.includes('Initial commit test'));
  } finally {
    process.env.GETIT_BACKUP_ROOT = originalBackupRoot;
    process.env.GETIT_TEST_MODE = originalTestMode;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Phase 3: Stateful Rollback & Manifest Signature Syncing', async () => {
  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'getit-workspace-test-'));
  const trackingBase = path.join(tempWorkspace, 'tracking-base');
  fs.mkdirSync(trackingBase, { recursive: true });

  const originalBackupRoot = process.env.GETIT_BACKUP_ROOT;
  const originalTestMode = process.env.GETIT_TEST_MODE;
  const originalCwd = process.cwd();

  process.env.GETIT_BACKUP_ROOT = trackingBase;
  process.env.GETIT_TEST_MODE = 'true';
  process.chdir(tempWorkspace);

  try {
    const liveFile = path.join(tempWorkspace, 'pyproject.toml');
    fs.writeFileSync(liveFile, '[tool.poetry]\nname = "v1"\n', 'utf-8');

    // Init manifest
    await await initWorkspaceManifest(tempWorkspace);
    const manifest1 = await loadWorkspaceManifest(tempWorkspace);
    assert.ok(manifest1.trackedPaths['pyproject.toml']);

    // Stage v1 to tracking
    await stageToTracking(tempWorkspace, 'pyproject.toml');

    const history1 = await WorkspaceHistoryManager.getHistory();
    assert.strictEqual(history1.length, 1);
    const commitHashV1 = history1[0].hash;

    // Modify file to v2
    fs.writeFileSync(liveFile, '[tool.poetry]\nname = "v2"\n', 'utf-8');
    // Stage v2 to tracking
    await stageToTracking(tempWorkspace, 'pyproject.toml');

    const history2 = await WorkspaceHistoryManager.getHistory();
    assert.strictEqual(history2.length, 2);

    // Modify live workspace file to create "drift"
    fs.writeFileSync(liveFile, '[tool.poetry]\nname = "drifted"\n', 'utf-8');

    // Preview Rollback to v1
    const diff = await WorkspaceRollbackManager.previewRollback(commitHashV1);
    assert.ok(diff.includes('pyproject.toml'));
    assert.ok(diff.includes('drifted'));
    assert.ok(diff.includes('v1'));

    // Execute Rollback to v1
    await WorkspaceRollbackManager.executeRollback(commitHashV1);

    // Assert that the file is restored to v1
    const rolledBackContent = fs.readFileSync(liveFile, 'utf-8');
    assert.strictEqual(rolledBackContent, '[tool.poetry]\nname = "v1"\n');

    // Assert that manifest has been updated
    const updatedManifest = await loadWorkspaceManifest(tempWorkspace);
    assert.strictEqual(updatedManifest.trackedPaths['pyproject.toml'].hash, manifest1.trackedPaths['pyproject.toml'].hash);
  } finally {
    process.env.GETIT_BACKUP_ROOT = originalBackupRoot;
    process.env.GETIT_TEST_MODE = originalTestMode;
    process.chdir(originalCwd);
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  }
});

test('Phase 3: Rollback Security Boundary Check', async () => {
  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'getit-boundary-test-'));
  const trackingBase = path.join(tempWorkspace, 'tracking-base');
  fs.mkdirSync(trackingBase, { recursive: true });

  const originalBackupRoot = process.env.GETIT_BACKUP_ROOT;
  const originalTestMode = process.env.GETIT_TEST_MODE;
  const originalCwd = process.cwd();

  process.env.GETIT_BACKUP_ROOT = trackingBase;
  process.env.GETIT_TEST_MODE = 'true';
  process.chdir(tempWorkspace);

  try {
    // Init manifest
    await await initWorkspaceManifest(tempWorkspace);

    // Write a mock commit
    const liveFile = path.join(tempWorkspace, 'Cargo.toml');
    fs.writeFileSync(liveFile, 'dependencies = {}', 'utf-8');
    await stageToTracking(tempWorkspace, 'Cargo.toml');

    const history = await WorkspaceHistoryManager.getHistory();
    const commitHash = history[0].hash;

    // Target a path outside the workspace
    const outsidePath = path.resolve(path.join(tempWorkspace, '..', 'forbidden.txt'));

    // previewRollback should reject outside file
    await assert.rejects(
      async () => {
        await WorkspaceRollbackManager.previewRollback(commitHash, outsidePath);
      },
      /Security Exception/
    );

    // executeRollback should reject outside file
    await assert.rejects(
      async () => {
        await WorkspaceRollbackManager.executeRollback(commitHash, outsidePath);
      },
      /Security Exception/
    );
  } finally {
    process.env.GETIT_BACKUP_ROOT = originalBackupRoot;
    process.env.GETIT_TEST_MODE = originalTestMode;
    process.chdir(originalCwd);
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  }
});
