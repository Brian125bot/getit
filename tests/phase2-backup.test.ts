import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { configureRuntimeSession, startPromptTransaction } from '../src/runtime/session.js';
import { manageFile } from '../src/tools/manage-file.js';
import { undoLatestTransaction } from '../src/backup/shadow-store.js';

process.env.GETIT_TEST_MODE = 'true';

test('Phase 2 backup ledger restores latest transaction batch', async () => {
  const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'getit-backup-'));
  process.env.GETIT_BACKUP_ROOT = backupRoot;
  configureRuntimeSession({ dryRun: false, policyProfile: 'override' });
  startPromptTransaction();

  const file = path.join(os.tmpdir(), `getit-backup-file-${Date.now()}.txt`);
  fs.writeFileSync(file, 'before', 'utf-8');
  const patched = await manageFile('patch', file, undefined, 'before', 'after');
  assert.strictEqual(patched.success, true);
  assert.strictEqual(fs.readFileSync(file, 'utf-8'), 'after');

  const undo = await undoLatestTransaction();
  assert.strictEqual(undo.success, true);
  assert.strictEqual(fs.readFileSync(file, 'utf-8'), 'before');
});
