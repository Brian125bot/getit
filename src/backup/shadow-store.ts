import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { appendOperation, getBackupRoot, latestTransaction, LedgerOperation } from './ledger.js';
import { getRuntimeSession } from '../runtime/session.js';

export function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function snapshotBeforeWrite(filePath: string, action: 'file_create' | 'file_patch'): void {
  const session = getRuntimeSession();
  const existedBefore = fs.existsSync(filePath);
  let snapshotPath: string | null = null;
  let mode: number | undefined;
  let sha256Before: string | undefined;

  if (existedBefore) {
    const bytes = fs.readFileSync(filePath);
    const digest = sha256(`${filePath}\0${Date.now()}\0${bytes.length}`);
    snapshotPath = path.join(getBackupRoot(), 'snapshots', digest);
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.writeFileSync(snapshotPath, bytes);
    const stats = fs.statSync(filePath);
    mode = stats.mode;
    sha256Before = sha256(bytes);
  }

  appendOperation(session.transactionId, session.promptId, {
    type: action,
    path: filePath,
    snapshotPath,
    existedBefore,
    restorable: true,
    mode,
    sha256Before
  });
}

export function recordCommand(command: string, cwd: string, exitCode?: number): void {
  const session = getRuntimeSession();
  appendOperation(session.transactionId, session.promptId, {
    type: 'command',
    command,
    cwd,
    exitCode,
    restorable: false,
    note: 'System command changes cannot be rolled back automatically. Review the command and manually revert package or permission changes if needed.'
  });
}

export async function undoLatestTransaction(options: { confirmMixed?: () => Promise<boolean> } = {}): Promise<{ success: boolean; message: string }> {
  const tx = latestTransaction();
  if (!tx) return { success: false, message: 'No getit backup transactions found.' };

  const nonRestorable = tx.operations.filter((op): op is Extract<LedgerOperation, { restorable: false }> => !op.restorable);
  if (nonRestorable.length > 0) {
    if (!options.confirmMixed) {
      return { success: false, message: formatMixedWarning(nonRestorable) };
    }
    console.log(formatMixedWarning(nonRestorable));
    const approved = await options.confirmMixed();
    if (!approved) return { success: false, message: 'Undo cancelled.' };
  }

  for (const op of [...tx.operations].reverse()) {
    if (!op.restorable) continue;
    if (op.existedBefore && op.snapshotPath) {
      fs.mkdirSync(path.dirname(op.path), { recursive: true });
      fs.copyFileSync(op.snapshotPath, op.path);
      if (op.mode !== undefined) fs.chmodSync(op.path, op.mode);
    } else if (!op.existedBefore && fs.existsSync(op.path)) {
      fs.unlinkSync(op.path);
    }
  }

  const extra = nonRestorable.length > 0 ? ` Non-restorable command records remain in the ledger.` : '';
  return { success: true, message: `Restored transaction ${tx.transactionId}.${extra}` };
}

export function formatMixedWarning(ops: Array<{ command: string; note: string }>): string {
  return [
    'Warning: This transaction included system commands that cannot be automatically rolled back.',
    ...ops.map((op) => `- ${op.command}\n  ${op.note}`)
  ].join('\n');
}
