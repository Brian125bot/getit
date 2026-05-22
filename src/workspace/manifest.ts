import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import { discoverEnvironment } from '../discovery/environment.js';
import { scrubText, MaskingSession } from '../security/scrubber.js';

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

  // Find common files to track in the workspace root
  const candidates = [
    'package.json',
    'Cargo.toml',
    'pyproject.toml',
    'go.mod',
    '.nvmrc',
    '.getitignore',
    '.env',
    '.gitignore',
    'README.md'
  ];

  for (const candidate of candidates) {
    const fullPath = path.join(rootPath, candidate);
    if (fs.existsSync(fullPath)) {
      const stat = fs.statSync(fullPath);
      if (stat.isFile()) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const hash = computeScrubbedHash(content);
        manifest.trackedPaths[candidate] = {
          hash,
          mode: stat.mode,
          mtime: stat.mtimeMs
        };
      }
    }
  }

  const manifestPath = path.join(rootPath, MANIFEST_FILENAME);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  
  return manifest;
}

export function loadWorkspaceManifest(rootPath: string): WorkspaceManifest {
  const manifestPath = path.join(rootPath, MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found at ${manifestPath}`);
  }
  const content = fs.readFileSync(manifestPath, 'utf-8');
  return JSON.parse(content) as WorkspaceManifest;
}

export function saveWorkspaceManifest(rootPath: string, manifest: WorkspaceManifest): void {
  const manifestPath = path.join(rootPath, MANIFEST_FILENAME);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}
