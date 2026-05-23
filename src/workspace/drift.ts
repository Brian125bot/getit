import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
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

const HASH_BATCH_SIZE = 5;

async function evaluateTrackedEntry(
  workspaceRoot: string,
  relPath: string,
  meta: { hash: string }
): Promise<FileDriftStatus> {
  const liveFile = path.join(workspaceRoot, relPath);

  try {
    await fsp.access(liveFile);
  } catch {
    return { path: relPath, status: 'missing', manifestHash: meta.hash };
  }

  try {
    const liveContent = await fsp.readFile(liveFile, 'utf-8');
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
    manifest = await loadWorkspaceManifest(workspaceRoot);
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

  const profileCandidates = await collectProfileCandidatePaths(workspaceRoot, manifest.fingerprint);
  const allCandidates = [...CONFIG_CANDIDATES, ...profileCandidates];

  for (let i = 0; i < allCandidates.length; i += HASH_BATCH_SIZE) {
    const batch = allCandidates.slice(i, i + HASH_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (candidate) => {
        if (manifest.trackedPaths[candidate]) {
          return null;
        }
        const liveFile = path.join(workspaceRoot, candidate);
        try {
          const stat = await fsp.stat(liveFile);
          if (stat.isFile()) {
            return { path: candidate, status: 'untracked' as const };
          }
        } catch {
          // skip inaccessible candidates
        }
        return null;
      })
    );

    for (const fileStatus of batchResults) {
      if (fileStatus) {
        result.push(fileStatus);
        hasDrift = true;
      }
    }
  }

  return { hasDrift, files: result };
}
