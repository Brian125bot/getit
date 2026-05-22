import * as fs from 'node:fs';
import * as path from 'node:path';

export const COMMON_DIR = 'common';
export const PROFILES_DIR = 'profiles';

const MAX_PROFILE_DEPTH = 3;

/**
 * Ensures shared common/ and machine-specific profiles/<fingerprint>/ directories exist.
 */
export function ensureProfileLayout(workspaceRoot: string, fingerprint: string): void {
  const commonPath = path.join(workspaceRoot, COMMON_DIR);
  const profilePath = getProfileDir(workspaceRoot, fingerprint);

  fs.mkdirSync(commonPath, { recursive: true });
  fs.mkdirSync(profilePath, { recursive: true });

  const readme = path.join(commonPath, 'README.md');
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(
      readme,
      '# getit common profile\n\nPlace shared configuration files here. They apply to all machines.\n',
      'utf-8'
    );
  }

  const profileReadme = path.join(profilePath, 'README.md');
  if (!fs.existsSync(profileReadme)) {
    fs.writeFileSync(
      profileReadme,
      `# getit machine profile (${fingerprint.slice(0, 8)}…)\n\nMachine-specific overrides for this host fingerprint.\n`,
      'utf-8'
    );
  }
}

export function getProfileDir(workspaceRoot: string, fingerprint: string): string {
  return path.join(workspaceRoot, PROFILES_DIR, fingerprint);
}

/**
 * Collects relative paths under common/ and profiles/<fingerprint>/ (metadata-only candidates).
 */
export function collectProfileCandidatePaths(workspaceRoot: string, fingerprint: string): string[] {
  const results: string[] = [];
  const bases = [
    { abs: path.join(workspaceRoot, COMMON_DIR), rel: COMMON_DIR },
    { abs: getProfileDir(workspaceRoot, fingerprint), rel: path.join(PROFILES_DIR, fingerprint) }
  ];

  for (const { abs, rel } of bases) {
    if (!fs.existsSync(abs)) continue;
    walkProfileTree(abs, rel, 0, results);
  }

  return results.sort();
}

function walkProfileTree(absDir: string, relPrefix: string, depth: number, results: string[]): void {
  if (depth > MAX_PROFILE_DEPTH) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const relPath = path.join(relPrefix, entry.name).replace(/\\/g, '/');
    const absPath = path.join(absDir, entry.name);

    if (entry.isDirectory()) {
      walkProfileTree(absPath, relPath, depth + 1, results);
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
