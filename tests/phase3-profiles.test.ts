import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initWorkspaceManifest, loadWorkspaceManifest } from '../src/workspace/manifest.js';
import {
  COMMON_DIR,
  PROFILES_DIR,
  ensureProfileLayout,
  collectProfileCandidatePaths,
  getProfileDir
} from '../src/workspace/profiles.js';

test('Phase 3 Profiles: manifest init creates common/ and profiles/<fingerprint>/', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getit-profiles-'));

  try {
    const manifest = await initWorkspaceManifest(tempDir);

    assert.ok(fs.existsSync(path.join(tempDir, COMMON_DIR)));
    assert.ok(fs.existsSync(getProfileDir(tempDir, manifest.fingerprint)));

    const profileConfig = path.join(getProfileDir(tempDir, manifest.fingerprint), 'machine.env');
    fs.writeFileSync(profileConfig, 'HOST=dev\n', 'utf-8');

    const rel = path.join(PROFILES_DIR, manifest.fingerprint, 'machine.env').replace(/\\/g, '/');
    const candidates = await collectProfileCandidatePaths(tempDir, manifest.fingerprint);
    assert.ok(candidates.includes(rel));

    const manifest2 = await loadWorkspaceManifest(tempDir);
    assert.ok(!manifest2.trackedPaths[rel]);

    fs.writeFileSync(path.join(tempDir, '.getit-manifest.json'), JSON.stringify(manifest2), 'utf-8');
    ensureProfileLayout(tempDir, manifest.fingerprint);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Phase 3 Profiles: common/ files are tracked on re-init', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getit-profiles-common-'));

  try {
    await initWorkspaceManifest(tempDir);
    const first = await loadWorkspaceManifest(tempDir);

    const sharedPath = path.join(tempDir, COMMON_DIR, 'shared.env');
    fs.writeFileSync(sharedPath, 'SHARED=1\n', 'utf-8');

    await initWorkspaceManifest(tempDir);
    const second = await loadWorkspaceManifest(tempDir);

    const rel = `${COMMON_DIR}/shared.env`;
    assert.ok(second.trackedPaths[rel], 'common/shared.env should be tracked after re-init');
    assert.strictEqual(first.fingerprint, second.fingerprint);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
