import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync, execFileSync } from 'node:child_process';
import { scrubText, MaskingSession } from '../security/scrubber.js';
import { resolveLiveFilePath } from './profiles.js';

/**
 * Resolves the tracking repository root directory and ensures it is initialized as a Git repository.
 */
export function getTrackingRoot(): string {
  const home = os.homedir();
  const base = process.env.GETIT_BACKUP_ROOT || path.join(home, '.local/state/getit');
  const trackingDir = path.join(base, 'tracking');
  if (!fs.existsSync(trackingDir)) {
    fs.mkdirSync(trackingDir, { recursive: true });
  }
  
  // Initialize git repo if not present
  const gitDir = path.join(trackingDir, '.git');
  if (!fs.existsSync(gitDir)) {
    try {
      execFileSync('git', ['init'], { cwd: trackingDir, stdio: 'ignore' });
      // Configure simple git details to prevent errors on commit
      execFileSync('git', ['config', 'user.name', 'getit'], { cwd: trackingDir, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.email', 'agent@getit.local'], { cwd: trackingDir, stdio: 'ignore' });
    } catch {
      // If git init fails (e.g. git is not installed), fail gracefully or skip git tracking features
    }
  }
  return trackingDir;
}

/**
 * Scrubs secrets using the existing entropy-scrubber but replaces session-based tokens
 * with a standardized [REDACTED_SECRET] string to prevent dynamic git churn.
 */
export function scrubContentGeneric(content: string): string {
  const session = new MaskingSession();
  const scrubbed = scrubText(content, session);
  return scrubbed.replace(/\[REDACTED_\d+\]/g, '[REDACTED_SECRET]');
}

/**
 * Copies a file from the workspace, scrubs it of credentials, and stages/commits it in the tracking repository.
 */
export async function stageToTracking(workspaceRoot: string, relativePath: string): Promise<void> {
  const liveFile = resolveLiveFilePath(workspaceRoot, relativePath);
  if (!fs.existsSync(liveFile)) {
    throw new Error(`File does not exist: ${liveFile}`);
  }

  const content = fs.readFileSync(liveFile, 'utf-8');
  const scrubbed = scrubContentGeneric(content);

  const trackingRoot = getTrackingRoot();
  const targetFile = path.join(trackingRoot, relativePath);

  // Ensure target directory exists in tracking repo
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.writeFileSync(targetFile, scrubbed, 'utf-8');

  // Sync permissions
  const stat = fs.statSync(liveFile);
  fs.chmodSync(targetFile, stat.mode);

  // Commit changes to tracking git if available
  try {
    execFileSync('git', ['add', relativePath], { cwd: trackingRoot, stdio: 'ignore' });
    // Check if there are changes before committing to avoid zero-exit status failures or warnings
    const status = execFileSync('git', ['status', '--porcelain', relativePath], { cwd: trackingRoot, encoding: 'utf-8' });
    if (status.trim().length > 0) {
      execFileSync('git', ['commit', '-m', `Tracked configuration update: ${relativePath}`], {
        cwd: trackingRoot,
        stdio: 'ignore',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'getit-agent',
          GIT_AUTHOR_EMAIL: 'getit@local',
          GIT_COMMITTER_NAME: 'getit-agent',
          GIT_COMMITTER_EMAIL: 'getit@local'
        }
      });
    }
  } catch (err) {
    // Fail silently if git fails
  }
}

/**
 * Returns the scrubbed content of a file stored in the tracking repository.
 */
export async function inspectTrackedFile(workspaceRoot: string, relativePath: string): Promise<string> {
  const trackingRoot = getTrackingRoot();
  const targetFile = path.join(trackingRoot, relativePath);
  if (!fs.existsSync(targetFile)) {
    return '[Not yet tracked]';
  }
  return fs.readFileSync(targetFile, 'utf-8');
}
