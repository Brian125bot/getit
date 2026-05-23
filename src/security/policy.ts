import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { PolicyProfile } from '../runtime/session.js';

export interface PolicyRule {
  pattern: string;
  source: string;
}

export interface LoadedPolicy {
  block: PolicyRule[];
  allow: PolicyRule[];
}

export function getXdgConfigHome(): string {
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

export async function loadPolicy(startDir: string): Promise<LoadedPolicy> {
  const block: PolicyRule[] = [];
  const allow: PolicyRule[] = [];

  for (const filePath of await findGetitIgnoreFiles(startDir)) {
    for (const pattern of await readIgnorePatterns(filePath)) {
      block.push({ pattern: absolutizePattern(pattern, path.dirname(filePath)), source: filePath });
    }
  }

  const globalPath = path.join(getXdgConfigHome(), 'getit', 'policy.json');
  try {
    const parsed = JSON.parse(await fsp.readFile(globalPath, 'utf-8'));
    for (const pattern of asStringArray(parsed.block || parsed.blocks || parsed.deny)) {
      block.push({ pattern, source: globalPath });
    }
    for (const pattern of asStringArray(parsed.allow || parsed.allows || parsed.whitelist)) {
      allow.push({ pattern, source: globalPath });
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      block.push({ pattern: '**', source: `${globalPath} (invalid JSON fail-closed)` });
    }
  }

  return { block, allow };
}

export async function evaluatePolicy(targetPath: string, cwd: string, profile: PolicyProfile): Promise<{ allowed: boolean; reason?: string }> {
  const policy = await loadPolicy(cwd);

  for (const rule of policy.block) {
    if (globMatch(rule.pattern, targetPath)) {
      return { allowed: false, reason: `Path blocked by policy rule "${rule.pattern}" from ${rule.source}` };
    }
  }

  if (profile === 'strict') {
    const base = path.basename(targetPath);
    if (base.startsWith('.') && base !== '.getitignore') {
      return { allowed: false, reason: 'Strict policy blocks hidden configuration files.' };
    }
  }

  return { allowed: true };
}

async function findGetitIgnoreFiles(startDir: string): Promise<string[]> {
  const files: string[] = [];
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, '.getitignore');
    try {
      await fsp.access(candidate);
      files.unshift(candidate);
    } catch {}
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return files;
}

async function readIgnorePatterns(filePath: string): Promise<string[]> {
  try {
    const content = await fsp.readFile(filePath, 'utf-8');
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
  } catch {
    return ['**'];
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function absolutizePattern(pattern: string, baseDir: string): string {
  if (path.isAbsolute(pattern)) return pattern;
  if (pattern.startsWith('/')) return path.join(baseDir, pattern.slice(1));
  return pattern;
}

export function globMatch(pattern: string, targetPath: string): boolean {
  const normalizedTarget = normalize(targetPath);
  const normalizedPattern = normalize(pattern);
  if (!normalizedPattern.includes('/')) {
    const parts = normalizedTarget.split('/');
    return parts.some((part) => segmentMatch(normalizedPattern, part));
  }
  const regex = globToRegExp(normalizedPattern);
  return regex.test(normalizedTarget);
}

function normalize(value: string): string {
  return value.split(path.sep).join('/');
}

function segmentMatch(pattern: string, value: string): boolean {
  return globToRegExp(pattern).test(value);
}

function globToRegExp(pattern: string): RegExp {
  let out = '^';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    const next = pattern[i + 1];
    if (ch === '*' && next === '*') {
      out += '.*';
      i++;
    } else if (ch === '*') {
      out += '[^/]*';
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += ch.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  out += '$';
  return new RegExp(out);
}
