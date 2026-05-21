import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const HOME = os.homedir();

const BANNED_PREFIXES = [
  path.join(HOME, '.ssh'),
  '/etc',
  '/boot',
  '/dev',
  '/proc',
  '/sys',
  '/root',
  '/var/spool/cron',
  '/usr/bin',
  '/usr/sbin',
  '/bin',
  '/sbin',
  '/lib',
  '/usr/lib'
];

export function resolveRealPath(targetPath: string): string {
  let resolved = targetPath;
  if (targetPath.startsWith('~')) {
    resolved = path.join(HOME, targetPath.slice(1));
  }
  const absolute = path.resolve(resolved);

  // Walk up to find the longest existing parent path, resolve that real path,
  // and append any non-existing trailing segments.
  let current = absolute;
  const segments: string[] = [];

  while (current && current !== path.sep) {
    if (fs.existsSync(current)) {
      try {
        const realParent = fs.realpathSync(current);
        if (segments.length > 0) {
          return path.join(realParent, ...segments.reverse());
        }
        return realParent;
      } catch {
        break;
      }
    }
    const base = path.basename(current);
    if (base) {
      segments.push(base);
    }
    current = path.dirname(current);
  }

  // Fallback to absolute if standard traversal didn't resolve cleanly
  try {
    return fs.realpathSync(absolute);
  } catch {
    return absolute;
  }
}

export function resolvePath(targetPath: string): string {
  return resolveRealPath(targetPath);
}

export function isPathSafe(targetPath: string): boolean {
  try {
    const absolutePath = resolveRealPath(targetPath);
    for (const banned of BANNED_PREFIXES) {
      if (absolutePath === banned || absolutePath.startsWith(banned + path.sep)) {
        return false;
      }
    }
    // Prevent operating directly on root directory '/'
    if (absolutePath === '/') {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function assertPathSafe(targetPath: string): void {
  if (!isPathSafe(targetPath)) {
    throw new Error(`Security Exception: Access to path "${targetPath}" is banned.`);
  }
}

