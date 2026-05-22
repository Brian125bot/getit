import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getTrackingRoot } from './tracking.js';
import { scrubText, MaskingSession } from '../security/scrubber.js';

export interface RemoteStatus {
  hasRemote: boolean;
  remoteUrl?: string;
  isSynced: boolean;
  error?: string;
  ahead?: number;
  behind?: number;
}

/**
 * Checks the Git remote status of the tracking repository.
 * Performs a network fetch to measure ahead/behind commits.
 */
export function checkRemoteStatus(): RemoteStatus {
  const root = getTrackingRoot();
  try {
    const remotes = execSync('git remote -v', { cwd: root, encoding: 'utf-8' });
    if (!remotes || remotes.trim().length === 0) {
      return { hasRemote: false, isSynced: true };
    }
    const match = /origin\s+(\S+)\s+\(push\)/.exec(remotes);
    const remoteUrl = match ? match[1] : undefined;

    try {
      execSync('git fetch', { cwd: root, stdio: 'ignore', timeout: 5000 });
      const diff = execSync('git rev-list --left-right --count HEAD...origin/main', { cwd: root, encoding: 'utf-8' });
      const parts = diff.trim().split(/\s+/).map(Number);
      const ahead = parts[0] || 0;
      const behind = parts[1] || 0;
      return {
        hasRemote: true,
        remoteUrl,
        isSynced: ahead === 0 && behind === 0,
        ahead,
        behind
      };
    } catch (err: any) {
      return {
        hasRemote: true,
        remoteUrl,
        isSynced: false,
        error: `Network/Auth failure: ${err.message || 'remote fetch failed'}`
      };
    }
  } catch (err: any) {
    return {
      hasRemote: false,
      isSynced: false,
      error: err.message
    };
  }
}

/**
 * Scans the tracking repository recursively to ensure no unscrubbed high-entropy
 * credentials exist before syncing to the remote server.
 */
export function scanForSecrets(dir: string): void {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (file === '.git') {
      continue;
    }
    if (stat.isDirectory()) {
      scanForSecrets(fullPath);
    } else if (stat.isFile()) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const session = new MaskingSession();
      const doubleScrubbed = scrubText(content, session);
      if (doubleScrubbed !== content) {
        throw new Error(`Pre-Push Guard: Raw credentials or high-entropy secret detected in tracked file "${file}"! Sync aborted.`);
      }
    }
  }
}

/**
 * Safely pushes scrubbed tracked commits to remote repository origin main.
 * Incorporates local pre-push secrets scan.
 */
export async function syncWithRemote(): Promise<{ success: boolean; output: string }> {
  const root = getTrackingRoot();
  
  // 1. Run Pre-Push Secrets Guard
  try {
    scanForSecrets(root);
  } catch (err: any) {
    return {
      success: false,
      output: err.message
    };
  }

  // 2. Perform Sync
  try {
    const remotes = execSync('git remote -v', { cwd: root, encoding: 'utf-8' });
    if (!remotes || remotes.trim().length === 0) {
      return {
        success: false,
        output: 'No remote configured. Please configure a Git remote inside the tracking directory first.'
      };
    }

    const pushOut = execSync('git push origin main', { cwd: root, encoding: 'utf-8', timeout: 10000 });
    return {
      success: true,
      output: `Synchronization successful!\n${pushOut}`
    };
  } catch (err: any) {
    return {
      success: false,
      output: `Sync failed (fail-closed): ${err.message}`
    };
  }
}
