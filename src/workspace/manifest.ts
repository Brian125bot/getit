import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import { discoverEnvironment } from '../discovery/environment.js';
import { scrubText, MaskingSession } from '../security/scrubber.js';
import { ensureProfileLayout, collectProfileCandidatePaths } from './profiles.js';

export interface TrackedPathMetadata {
  hash: string;
  mode: number;
  mtime: number;
}

export interface WorkspaceManifest {
  fingerprint: string;
  initializedAt: string;
  platform: string;
  arch: string;
  packageManager: string;
  trackedPaths: Record<string, TrackedPathMetadata>;
}

export const MANIFEST_FILENAME = '.getit-manifest.json';

/** Root-level config files discovered at manifest init and during drift scans. */
export const CONFIG_CANDIDATES = [
  'package.json',
  'Cargo.toml',
  'pyproject.toml',
  'go.mod',
  '.nvmrc',
  '.getitignore',
  '.env',
  '.gitignore',
  'README.md'
] as const;

export function generateFingerprint(): string {
  const hash = crypto.createHash('sha256');
  hash.update(os.hostname());
  hash.update(os.platform());
  hash.update(os.arch());
  return hash.digest('hex');
}

export function computeScrubbedHash(content: string): string {
  const session = new MaskingSession();
  const scrubbed = scrubText(content, session);
  const normalized = scrubbed.replace(/\[REDACTED_\d+\]/g, '[REDACTED_SECRET]');
  return crypto.createHash('sha256').update(normalized, 'utf-8').digest('hex');
}

export async function initWorkspaceManifest(rootPath: string): Promise<WorkspaceManifest> {
  const env = discoverEnvironment();
  const fingerprint = generateFingerprint();
  
  const manifest: WorkspaceManifest = {
    fingerprint,
    initializedAt: new Date().toISOString(),
    platform: env.targetPlatform,
    arch: env.arch,
    packageManager: env.primaryPackageManager,
    trackedPaths: {}
  };

  await ensureProfileLayout(rootPath, fingerprint);

  const trackCandidates = [...CONFIG_CANDIDATES, ...(await collectProfileCandidatePaths(rootPath, fingerprint))];

  for (const candidate of trackCandidates) {
    if (manifest.trackedPaths[candidate]) continue;

    const fullPath = path.join(rootPath, candidate);
    try {
      const stat = await fsp.stat(fullPath);
      if (stat.isFile()) {
        const content = await fsp.readFile(fullPath, 'utf-8');
        const hash = computeScrubbedHash(content);
        manifest.trackedPaths[candidate] = {
          hash,
          mode: stat.mode,
          mtime: stat.mtimeMs
        };
      }
    } catch {}
  }

  const manifestPath = path.join(rootPath, MANIFEST_FILENAME);
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  
  return manifest;
}

export async function loadWorkspaceManifest(rootPath: string): Promise<WorkspaceManifest> {
  const manifestPath = path.join(rootPath, MANIFEST_FILENAME);
  try {
    const content = await fsp.readFile(manifestPath, 'utf-8');
    return JSON.parse(content) as WorkspaceManifest;
  } catch (e) {
    throw new Error(`Manifest not found at ${manifestPath}`);
  }
}

export async function saveWorkspaceManifest(rootPath: string, manifest: WorkspaceManifest): Promise<void> {
  const manifestPath = path.join(rootPath, MANIFEST_FILENAME);
  await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}
