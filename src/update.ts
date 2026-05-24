import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const execFileAsync = promisify(execFile);

export function getRepoRoot(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    let current = __dirname;
    while (current !== '/' && current !== '.') {
      if (existsSync(join(current, 'package.json')) && existsSync(join(current, '.git'))) {
        return current;
      }
      current = dirname(current);
    }
  } catch {
    // ignore
  }
  return process.cwd(); // fallback
}

export async function checkForUpdates(): Promise<boolean> {
  try {
    const repoRoot = getRepoRoot();
    const { stdout: localOut } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot });
    const localSha = localOut.trim();

    const { stdout: remoteOut } = await execFileAsync('git', ['ls-remote', 'origin', 'HEAD'], { cwd: repoRoot });
    const remoteSha = remoteOut.split('\t')[0].trim();

    if (localSha && remoteSha && localSha !== remoteSha) {
      return true;
    }
  } catch {
    // If anything fails (e.g., git not installed, not a git repo, no network), suppress error and return false
  }
  return false;
}

export async function performUpdate(): Promise<void> {
  const repoRoot = getRepoRoot();
  console.log('  \x1b[36m[updater] Pulling latest changes from repository...\x1b[0m');
  await execFileAsync('git', ['pull'], { cwd: repoRoot });
  console.log('  \x1b[36m[updater] Rebuilding source files...\x1b[0m');
  await execFileAsync('npm', ['run', 'build'], { cwd: repoRoot });
}
