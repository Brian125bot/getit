import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { evaluatePolicy } from './policy.js';
import { getRuntimeSession, PolicyProfile } from '../runtime/session.js';

const HOME = os.homedir();

const CATASTROPHIC_BLOCKS = [
  '/dev',
  '/proc',
  '/sys',
  '/boot',
  '/root',
  '/etc/shadow',
  '/etc/sudoers'
];

const DEFAULT_BLOCKS = [
  path.join(HOME, '.ssh'),
  '/etc',
  '/var/spool/cron',
  '/usr/bin',
  '/usr/sbin',
  '/bin',
  '/sbin',
  '/lib',
  '/usr/lib'
];

export interface PathPolicyResult {
  allowed: boolean;
  resolvedPath: string;
  reason?: string;
}

export function resolveRealPath(targetPath: string): string {
  let resolved = targetPath;
  if (targetPath.startsWith('~')) resolved = path.join(HOME, targetPath.slice(1));
  const absolute = path.resolve(resolved);

  let current = absolute;
  const segments: string[] = [];
  while (current && current !== path.sep) {
    if (fs.existsSync(current)) {
      const realParent = fs.realpathSync(current);
      return segments.length > 0 ? path.join(realParent, ...segments.reverse()) : realParent;
    }
    const base = path.basename(current);
    if (base) segments.push(base);
    current = path.dirname(current);
  }
  return absolute;
}

export function validatePath(targetPath: string, options: { cwd?: string; profile?: PolicyProfile } = {}): PathPolicyResult {
  const profile = options.profile || getRuntimeSession().policyProfile;
  const cwd = options.cwd || process.cwd();
  let resolvedPath: string;
  try {
    resolvedPath = resolveRealPath(targetPath);
  } catch (err: any) {
    return { allowed: false, resolvedPath: path.resolve(targetPath), reason: err.message };
  }

  if (resolvedPath === '/') {
    return { allowed: false, resolvedPath, reason: 'Access to root path is blocked.' };
  }

  for (const blocked of CATASTROPHIC_BLOCKS) {
    if (matchesPrefix(resolvedPath, blocked)) {
      return { allowed: false, resolvedPath, reason: `Access to catastrophic system path "${blocked}" is blocked.` };
    }
  }

  if (profile !== 'override') {
    for (const blocked of DEFAULT_BLOCKS) {
      if (matchesPrefix(resolvedPath, blocked)) {
        return { allowed: false, resolvedPath, reason: `Access to protected path "${blocked}" is blocked.` };
      }
    }
  }

  const policy = evaluatePolicy(resolvedPath, cwd, profile);
  if (!policy.allowed) {
    return { allowed: false, resolvedPath, reason: policy.reason };
  }

  return { allowed: true, resolvedPath };
}

export function assertPathAllowed(targetPath: string, options: { cwd?: string; profile?: PolicyProfile } = {}): string {
  const result = validatePath(targetPath, options);
  if (!result.allowed) {
    throw new Error(`Security Exception: ${result.reason || `Access to path "${targetPath}" is blocked.`}`);
  }
  return result.resolvedPath;
}

function matchesPrefix(target: string, prefix: string): boolean {
  return target === prefix || target.startsWith(prefix + path.sep);
}
