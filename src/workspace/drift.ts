import * as fs from 'node:fs';
import * as path from 'node:path';
import { readFile } from 'node:fs/promises';
import { loadWorkspaceManifest, WorkspaceManifest, computeScrubbedHash, CONFIG_CANDIDATES } from './manifest.js';
import { collectProfileCandidatePaths } from './profiles.js';

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

const HASH_BATCH_SIZE = 32;

async function evaluateTrackedEntry(
  workspaceRoot: string,
  relPath: string,
  meta: { hash: string }
): Promise<FileDriftStatus> {
  const liveFile = path.join(workspaceRoot, relPath);

  if (!fs.existsSync(liveFile)) {
    return { path: relPath, status: 'missing', manifestHash: meta.hash };
  }

  try {
    const liveContent = await readFile(liveFile, 'utf-8');
    const liveHash = computeScrubbedHash(liveContent);

    if (liveHash !== meta.hash) {
      return {
        path: relPath,
        status: 'modified',
        liveHash,
        manifestHash: meta.hash
      };
    }
    return {
      path: relPath,
      status: 'unmodified',
      liveHash,
      manifestHash: meta.hash
    };
  } catch {
    return { path: relPath, status: 'missing', manifestHash: meta.hash };
  }
}

/**
 * Computes and compares live scrubbed file hashes against the workspace manifest.
 * Uses batched async I/O for tracked paths (DRF_002).
 */
export async function detectWorkspaceDrift(workspaceRoot: string): Promise<DriftResult> {
  let manifest: WorkspaceManifest;
  try {
    manifest = loadWorkspaceManifest(workspaceRoot);
  } catch {
    throw new Error(`Drift check failed: active workspace manifest not found in ${workspaceRoot}`);
  }

  const result: FileDriftStatus[] = [];
  let hasDrift = false;

  const trackedEntries = Object.entries(manifest.trackedPaths);

  for (let i = 0; i < trackedEntries.length; i += HASH_BATCH_SIZE) {
    const batch = trackedEntries.slice(i, i + HASH_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(([relPath, meta]) => evaluateTrackedEntry(workspaceRoot, relPath, meta))
    );

    for (const fileStatus of batchResults) {
      result.push(fileStatus);
      if (fileStatus.status !== 'unmodified') {
        hasDrift = true;
      }
    }
  }

  const profileCandidates = collectProfileCandidatePaths(workspaceRoot, manifest.fingerprint);
  const allCandidates = [...CONFIG_CANDIDATES, ...profileCandidates];

  for (const candidate of allCandidates) {
    if (manifest.trackedPaths[candidate]) {
      continue;
    }
    const liveFile = path.join(workspaceRoot, candidate);
    if (fs.existsSync(liveFile)) {
      try {
        const stat = fs.statSync(liveFile);
        if (stat.isFile()) {
          result.push({ path: candidate, status: 'untracked' });
          hasDrift = true;
        }
      } catch {
        // skip inaccessible candidates
      }
    }
  }

  return { hasDrift, files: result };
}
