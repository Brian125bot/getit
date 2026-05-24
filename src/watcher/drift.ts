/**
 * @module watcher/drift
 * @description Watch-mode drift detection integration.
 *
 * Triggers workspace drift re-scans when tracked configuration files
 * are modified by external tools.
 */
import type { WatchEvent } from './daemon.js';
import type { HookExecutionResult } from './hooks.js';
import { detectWorkspaceDrift } from '../workspace/drift.js';
import { findWorkspaceRoot } from '../workspace/boundary.js';

/**
 * Config files that trigger drift re-check on modification.
 */
const DRIFT_TRIGGER_FILES = new Set([
  'package.json', '.env', '.gitignore', '.nvmrc',
  'tsconfig.json', 'Cargo.toml', 'pyproject.toml',
  'go.mod', '.getitignore', 'README.md'
]);

/**
 * Check if a watch event should trigger a drift re-scan.
 */
export function isDriftTrigger(event: WatchEvent): boolean {
  const basename = event.relativePath.split('/').pop() || '';
  return DRIFT_TRIGGER_FILES.has(basename);
}

/**
 * Execute a drift detection scan.
 */
export async function executeDriftCheck(rootPath: string): Promise<HookExecutionResult> {
  const startTime = Date.now();

  try {
    const wsRoot = await findWorkspaceRoot(rootPath);
    if (!wsRoot) {
      return {
        hookName: 'drift-check',
        success: true,
        output: 'No workspace initialized. Skipping drift check.',
        durationMs: Date.now() - startTime
      };
    }

    const drift = await detectWorkspaceDrift(wsRoot);
    const modified = drift.files.filter(f => f.status === 'modified');
    const untracked = drift.files.filter(f => f.status === 'untracked');
    const missing = drift.files.filter(f => f.status === 'missing');

    const changes = modified.length + untracked.length + missing.length;

    if (changes === 0) {
      return {
        hookName: 'drift-check',
        success: true,
        output: 'No drift detected.',
        durationMs: Date.now() - startTime
      };
    }

    const parts: string[] = [];
    if (modified.length > 0) parts.push(`${modified.length} modified`);
    if (untracked.length > 0) parts.push(`${untracked.length} untracked`);
    if (missing.length > 0) parts.push(`${missing.length} missing`);

    return {
      hookName: 'drift-check',
      success: true,
      output: `Drift detected: ${parts.join(', ')}. Run /resolve to review.`,
      durationMs: Date.now() - startTime
    };
  } catch (err: any) {
    return {
      hookName: 'drift-check',
      success: false,
      output: `Drift check error: ${err.message}`,
      durationMs: Date.now() - startTime
    };
  }
}
