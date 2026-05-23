import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

export type LedgerOperation =
  | {
      type: 'file_create' | 'file_patch';
      path: string;
      snapshotPath: string | null;
      existedBefore: boolean;
      restorable: true;
      mode?: number;
      sha256Before?: string;
    }
  | {
      type: 'command';
      command: string;
      cwd: string;
      exitCode?: number;
      restorable: false;
      note: string;
    };

export interface LedgerTransaction {
  transactionId: string;
  promptId: string;
  timestamp: string;
  operations: LedgerOperation[];
}

export interface LedgerFile {
  transactions: LedgerTransaction[];
}

export function getBackupRoot(): string {
  if (process.env.GETIT_BACKUP_ROOT) return process.env.GETIT_BACKUP_ROOT;
  if (process.env.GETIT_TEST_MODE === 'true') return path.join(os.tmpdir(), 'getit-test-backup');
  const stateHome = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(stateHome, 'getit', 'backup');
}

export function getLedgerPath(): string {
  return path.join(getBackupRoot(), 'ledger.json');
}

export async function ensureBackupRoot(): Promise<void> {
  await fsp.mkdir(path.join(getBackupRoot(), 'snapshots'), { recursive: true });
  try {
    await fsp.access(getLedgerPath());
  } catch {
    await fsp.writeFile(getLedgerPath(), JSON.stringify({ transactions: [] }, null, 2), 'utf-8');
  }
}

export async function readLedger(): Promise<LedgerFile> {
  await ensureBackupRoot();
  try {
    return JSON.parse(await fsp.readFile(getLedgerPath(), 'utf-8')) as LedgerFile;
  } catch {
    return { transactions: [] };
  }
}

export async function appendOperation(transactionId: string, promptId: string, operation: LedgerOperation): Promise<void> {
  await ensureBackupRoot();
  const ledger = await readLedger();
  let tx = ledger.transactions.find((item) => item.transactionId === transactionId);
  if (!tx) {
    tx = { transactionId, promptId, timestamp: new Date().toISOString(), operations: [] };
    ledger.transactions.push(tx);
  }
  tx.operations.push(operation);
  
  const tempPath = `${getLedgerPath()}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(tempPath, JSON.stringify(ledger, null, 2), 'utf-8');
  await fsp.rename(tempPath, getLedgerPath());
}

export async function latestTransaction(): Promise<LedgerTransaction | undefined> {
  const ledger = await readLedger();
  return ledger.transactions[ledger.transactions.length - 1];
}
