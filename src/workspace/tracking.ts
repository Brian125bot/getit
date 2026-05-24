import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
const execFile = promisify(execFileCb);
import { scrubText, MaskingSession } from '../security/scrubber.js';
import { resolveLiveFilePath } from './profiles.js';
import { atomicWriteFile } from './fs-utils.js';

/**
 * Resolves the tracking repository root directory and ensures it is initialized as a Git repository.
 */
export async function getTrackingRoot(): Promise<string> {
  const home = os.homedir();
  const base = process.env.GETIT_BACKUP_ROOT || path.join(home, '.local/state/getit');
  const trackingDir = path.join(base, 'tracking');
  await fsp.mkdir(trackingDir, { recursive: true });
  
  // Initialize git repo if not present
  const gitDir = path.join(trackingDir, '.git');
  try {
    await fsp.access(gitDir);
  } catch {
    try {
      await execFile('git', ['init'], { cwd: trackingDir });
      // Configure simple git details to prevent errors on commit
      await execFile('git', ['config', 'user.name', 'getit'], { cwd: trackingDir });
      await execFile('git', ['config', 'user.email', 'agent@getit.local'], { cwd: trackingDir });
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
  try {
    await fsp.access(liveFile);
  } catch {
    throw new Error(`File does not exist: ${liveFile}`);
  }

  const content = await fsp.readFile(liveFile, 'utf-8');
  const scrubbed = scrubContentGeneric(content);

  const trackingRoot = await getTrackingRoot();
  const targetFile = path.join(trackingRoot, relativePath);

  // Ensure target directory exists in tracking repo
  await fsp.mkdir(path.dirname(targetFile), { recursive: true });
  await atomicWriteFile(targetFile, scrubbed);

  // Sync permissions
  const stat = await fsp.stat(liveFile);
  await fsp.chmod(targetFile, stat.mode);

  // Commit changes to tracking git if available
  try {
    await execFile('git', ['add', relativePath], { cwd: trackingRoot });
    // Check if there are changes before committing to avoid zero-exit status failures or warnings
    const { stdout: status } = await execFile('git', ['status', '--porcelain', relativePath], { cwd: trackingRoot, encoding: 'utf-8' });
    if (status.trim().length > 0) {
      await execFile('git', ['commit', '-m', `Tracked configuration update: ${relativePath}`], {
        cwd: trackingRoot,
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
  const trackingRoot = await getTrackingRoot();
  const targetFile = path.join(trackingRoot, relativePath);
  try {
    await fsp.access(targetFile);
  } catch {
    return '[Not yet tracked]';
  }
  return await fsp.readFile(targetFile, 'utf-8');
}
