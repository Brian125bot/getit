import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initWorkspaceManifest, MANIFEST_FILENAME } from '../src/workspace/manifest.js';

test('Phase 3 Profiles: manifest init creates common/ and profiles/<fingerprint>/', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getit-profiles-'));
  try {
    const manifest = await initWorkspaceManifest(tempDir);
    const commonDir = path.join(tempDir, 'common');
    const profileDir = path.join(tempDir, 'profiles', manifest.fingerprint);

    assert.ok(fs.existsSync(commonDir), 'common/ directory should be created');
    assert.ok(fs.existsSync(profileDir), 'profiles/<fingerprint>/ directory should be created');
    assert.ok(fs.existsSync(path.join(commonDir, 'README.md')), 'common/README.md should exist');
    assert.ok(fs.existsSync(path.join(profileDir, 'README.md')), 'profile README.md should exist');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Phase 3 Profiles: common/ files are tracked on re-init', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getit-profiles-reinit-'));
  try {
    await initWorkspaceManifest(tempDir);
    const commonFile = path.join(tempDir, 'common', 'config.json');
    fs.writeFileSync(commonFile, '{}', 'utf-8');

    const manifest = await initWorkspaceManifest(tempDir);
    assert.ok(manifest.trackedPaths['common/config.json'], 'common/ files should be tracked');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
