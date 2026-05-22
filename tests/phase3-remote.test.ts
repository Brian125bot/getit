import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { scanForSecrets, syncWithRemote } from '../src/workspace/remote.js';
import { getTrackingRoot } from '../src/workspace/tracking.js';

test('Phase 3 Remote: Pre-Push scan passes cleanly on scrubbed secrets', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getit-remote-clean-'));
  try {
    const file1 = path.join(tempDir, 'config.json');
    fs.writeFileSync(file1, JSON.stringify({
      apiKey: '[REDACTED_SECRET]',
      host: 'https://api.openai.com'
    }), 'utf-8');

    // Should complete cleanly without throwing
    assert.doesNotThrow(() => {
      scanForSecrets(tempDir);
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Phase 3 Remote: Pre-Push scan aborts on raw unscrubbed secrets', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getit-remote-dirty-'));
  try {
    const file1 = path.join(tempDir, 'key.env');
    // Write an unscrubbed raw API key
    fs.writeFileSync(file1, 'OPENAI_KEY=sk-unscrubbedkey12345678901234567890\n', 'utf-8');

    // Should throw pre-push secrets warning
    assert.throws(() => {
      scanForSecrets(tempDir);
    }, /Pre-Push Guard: Raw credentials or high-entropy secret detected/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Phase 3 Remote: syncWithRemote performs fail-closed on secret presence', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getit-backup-sync-'));
  const originalBackupRoot = process.env.GETIT_BACKUP_ROOT;
  process.env.GETIT_BACKUP_ROOT = tempDir;

  try {
    const trackingRoot = getTrackingRoot();
    
    // Inject a raw secret directly into the tracking root
    fs.writeFileSync(path.join(trackingRoot, 'dirty.env'), 'API_KEY=sk-badkey12345678901234567890\n', 'utf-8');

    // Attempting sync must fail-closed because pre-push secrets guard fires!
    const result = await syncWithRemote();
    
    assert.strictEqual(result.success, false);
    assert.ok(result.output.includes('Pre-Push Guard: Raw credentials or high-entropy secret detected'));
  } finally {
    process.env.GETIT_BACKUP_ROOT = originalBackupRoot;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
