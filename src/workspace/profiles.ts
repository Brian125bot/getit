import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { atomicWriteFile } from './fs-utils.js';

export const COMMON_DIR = 'common';
export const PROFILES_DIR = 'profiles';

const MAX_PROFILE_DEPTH = 3;

/**
 * Ensures shared common/ and machine-specific profiles/<fingerprint>/ directories exist.
 */
export async function ensureProfileLayout(workspaceRoot: string, fingerprint: string): Promise<void> {
  const commonPath = path.join(workspaceRoot, COMMON_DIR);
  const profilePath = getProfileDir(workspaceRoot, fingerprint);

  await fsp.mkdir(commonPath, { recursive: true });
  await fsp.mkdir(profilePath, { recursive: true });

  const readme = path.join(commonPath, 'README.md');
  try { await fsp.access(readme); } catch {
    await atomicWriteFile(
      readme,
      '# getit common profile\n\nPlace shared configuration files here. They apply to all machines.\n'
    );
  }

  const profileReadme = path.join(profilePath, 'README.md');
  try { await fsp.access(profileReadme); } catch {
    await atomicWriteFile(
      profileReadme,
      `# getit machine profile (${fingerprint.slice(0, 8)}…)\n\nMachine-specific overrides for this host fingerprint.\n`
    );
  }
}

export function getProfileDir(workspaceRoot: string, fingerprint: string): string {
  return path.join(workspaceRoot, PROFILES_DIR, fingerprint);
}

/**
 * Collects relative paths under common/ and profiles/<fingerprint>/ (metadata-only candidates).
 */
export async function collectProfileCandidatePaths(workspaceRoot: string, fingerprint: string): Promise<string[]> {
  const results: string[] = [];
  const bases = [
    { abs: path.join(workspaceRoot, COMMON_DIR), rel: COMMON_DIR },
    { abs: getProfileDir(workspaceRoot, fingerprint), rel: path.join(PROFILES_DIR, fingerprint) }
  ];

  for (const { abs, rel } of bases) {
    try { await fsp.access(abs); } catch { continue; }
    await walkProfileTree(abs, rel, 0, results);
  }

  return results.sort();
}

async function walkProfileTree(absDir: string, relPrefix: string, depth: number, results: string[]): Promise<void> {
  if (depth > MAX_PROFILE_DEPTH) return;

  let entries;
  try {
    entries = await fsp.readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const relPath = path.join(relPrefix, entry.name).replace(/\\/g, '/');
    const absPath = path.join(absDir, entry.name);

    if (entry.isDirectory()) {
      await walkProfileTree(absPath, relPath, depth + 1, results);
    } else if (entry.isFile() && entry.name !== 'README.md') {
      results.push(relPath);
    }
  }
}

/**
 * Resolves a tracked relative path to the live file on disk.
 * Profile-prefixed paths map under common/ or profiles/<fingerprint>/.
 */
export function resolveLiveFilePath(workspaceRoot: string, relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized.startsWith(`${COMMON_DIR}/`) || normalized.startsWith(`${PROFILES_DIR}/`)) {
    return path.join(workspaceRoot, normalized);
  }
  return path.join(workspaceRoot, normalized);
}
