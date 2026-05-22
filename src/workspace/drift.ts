import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { loadWorkspaceManifest, WorkspaceManifest } from './manifest.js';
import { scrubContentGeneric } from './tracking.js';

export interface FileDriftStatus {
  path: string;
  status: 'unmodified' | 'modified' | 'missing' | 'untracked';
  liveHash?: string;
  manifestHash?: string;
}

export interface DriftResult {
  hasDrift: boolean;
  files: FileDriftStatus[];
}

/**
 * Computes and compares live scrubbed file hashes against the workspace manifest.
 * Reports on all modified, missing, and untracked config candidates.
 */
export async function detectWorkspaceDrift(workspaceRoot: string): Promise<DriftResult> {
  let manifest: WorkspaceManifest;
  try {
    manifest = loadWorkspaceManifest(workspaceRoot);
  } catch (err) {
    throw new Error(`Drift check failed: active workspace manifest not found in ${workspaceRoot}`);
  }

  const result: FileDriftStatus[] = [];
  let hasDrift = false;

  // 1. Evaluate tracked files in manifest
  for (const [relPath, meta] of Object.entries(manifest.trackedPaths)) {
    const liveFile = path.join(workspaceRoot, relPath);
    if (!fs.existsSync(liveFile)) {
      result.push({
        path: relPath,
        status: 'missing',
        manifestHash: meta.hash
      });
      hasDrift = true;
      continue;
    }

    try {
      const liveContent = fs.readFileSync(liveFile, 'utf-8');
      const scrubbedContent = scrubContentGeneric(liveContent);
      const liveHash = crypto.createHash('sha256').update(scrubbedContent, 'utf-8').digest('hex');

      if (liveHash !== meta.hash) {
        result.push({
          path: relPath,
          status: 'modified',
          liveHash,
          manifestHash: meta.hash
        });
        hasDrift = true;
      } else {
        result.push({
          path: relPath,
          status: 'unmodified',
          liveHash,
          manifestHash: meta.hash
        });
      }
    } catch {
      // Treat read failures as missing/inaccessible
      result.push({
        path: relPath,
        status: 'missing',
        manifestHash: meta.hash
      });
      hasDrift = true;
    }
  }

  // 2. Discover candidates that exist on disk but are not tracked in the manifest
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
    if (manifest.trackedPaths[candidate]) {
      continue; // already tracked
    }
    const liveFile = path.join(workspaceRoot, candidate);
    if (fs.existsSync(liveFile)) {
      try {
        const stat = fs.statSync(liveFile);
        if (stat.isFile()) {
          result.push({
            path: candidate,
            status: 'untracked'
          });
          hasDrift = true;
        }
      } catch {}
    }
  }

  return {
    hasDrift,
    files: result
  };
}
