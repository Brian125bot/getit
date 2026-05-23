import * as path from 'node:path';
import * as os from 'node:os';
import * as fsp from 'node:fs/promises';
import { evaluatePolicy } from './policy.js';
import { getRuntimeSession, PolicyProfile } from '../runtime/session.js';
import { findWorkspaceRoot, isPathInWorkspace } from '../workspace/boundary.js';

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

export async function resolveRealPath(targetPath: string): Promise<string> {
  let resolved = targetPath;
  if (targetPath.startsWith('~')) resolved = path.join(HOME, targetPath.slice(1));
  const absolute = path.resolve(resolved);

  let current = absolute;
  const segments: string[] = [];
  while (current && current !== path.sep) {
    let exists = false;
    try { await fsp.access(current); exists = true; } catch {}
    
    if (exists) {
      const realParent = await fsp.realpath(current);
      return segments.length > 0 ? path.join(realParent, ...segments.reverse()) : realParent;
    }
    const base = path.basename(current);
    if (base) segments.push(base);
    current = path.dirname(current);
  }
  return absolute;
}

export async function validatePath(targetPath: string, options: { cwd?: string; profile?: PolicyProfile } = {}): Promise<PathPolicyResult> {
  const profile = options.profile || getRuntimeSession().policyProfile;
  const cwd = options.cwd || process.cwd();
  let resolvedPath: string;
  try {
    resolvedPath = await resolveRealPath(targetPath);
  } catch (err: any) {
    return { allowed: false, resolvedPath: path.resolve(targetPath), reason: err.message };
  }

  if (resolvedPath === '/') {
    return { allowed: false, resolvedPath, reason: 'Access to root path is blocked.' };
  }

  // Enforce workspace boundary if workspace is active
  const workspaceRoot = await findWorkspaceRoot(cwd);
  if (workspaceRoot) {
    if (!isPathInWorkspace(resolvedPath, workspaceRoot)) {
      return { allowed: false, resolvedPath, reason: `Path "${resolvedPath}" lies outside the active workspace boundary at "${workspaceRoot}".` };
    }
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

  const policy = await evaluatePolicy(resolvedPath, cwd, profile);
  if (!policy.allowed) {
    return { allowed: false, resolvedPath, reason: policy.reason };
  }

  return { allowed: true, resolvedPath };
}

export async function assertPathAllowed(targetPath: string, options: { cwd?: string; profile?: PolicyProfile } = {}): Promise<string> {
  const result = await validatePath(targetPath, options);
  if (!result.allowed) {
    throw new Error(`Security Exception: ${result.reason || `Access to path "${targetPath}" is blocked.`}`);
  }
  return result.resolvedPath;
}

function matchesPrefix(target: string, prefix: string): boolean {
  return target === prefix || target.startsWith(prefix + path.sep);
}
