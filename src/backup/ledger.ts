import * as fs from 'node:fs';
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

export function ensureBackupRoot(): void {
  mkdirp(path.join(getBackupRoot(), 'snapshots'));
  if (!fs.existsSync(getLedgerPath())) {
    fs.writeFileSync(getLedgerPath(), JSON.stringify({ transactions: [] }, null, 2), 'utf-8');
  }
}

function mkdirp(dirPath: string): void {
  const parsed = path.parse(dirPath);
  let current = parsed.root;
  for (const part of dirPath.slice(parsed.root.length).split(path.sep)) {
    if (!part) continue;
    current = path.join(current, part);
    if (!fs.existsSync(current)) {
      fs.mkdirSync(current);
    }
  }
}

export function readLedger(): LedgerFile {
  ensureBackupRoot();
  try {
    return JSON.parse(fs.readFileSync(getLedgerPath(), 'utf-8')) as LedgerFile;
  } catch {
    return { transactions: [] };
  }
}

export function appendOperation(transactionId: string, promptId: string, operation: LedgerOperation): void {
  ensureBackupRoot();
  const ledger = readLedger();
  let tx = ledger.transactions.find((item) => item.transactionId === transactionId);
  if (!tx) {
    tx = { transactionId, promptId, timestamp: new Date().toISOString(), operations: [] };
    ledger.transactions.push(tx);
  }
  tx.operations.push(operation);
  fs.writeFileSync(getLedgerPath(), JSON.stringify(ledger, null, 2), 'utf-8');
}

export function latestTransaction(): LedgerTransaction | undefined {
  const ledger = readLedger();
  return ledger.transactions[ledger.transactions.length - 1];
}
