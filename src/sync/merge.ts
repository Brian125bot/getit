/**
 * @module sync/merge
 * @description Conflict resolution for multi-machine profile synchronization.
 *
 * When importing a profile that conflicts with the current configuration,
 * the merge module provides strategies for resolving differences.
 */
import type { SyncProfile, CarrierProfile } from './profiles.js';

export type MergeStrategy = 'local' | 'remote' | 'manual';

export interface MergeConflict {
  field: string;
  localValue: unknown;
  remoteValue: unknown;
  resolved?: unknown;
  strategy?: MergeStrategy;
}

export interface MergeResult {
  conflicts: MergeConflict[];
  merged: Partial<SyncProfile>;
  hasConflicts: boolean;
}

/**
 * Detect conflicts between local and remote profiles.
 */
export function detectConflicts(
  local: SyncProfile,
  remote: SyncProfile
): MergeConflict[] {
  const conflicts: MergeConflict[] = [];

  // Carrier conflicts
  if (local.carrier.carrierId !== remote.carrier.carrierId) {
    conflicts.push({
      field: 'carrier.carrierId',
      localValue: local.carrier.carrierId,
      remoteValue: remote.carrier.carrierId
    });
  }

  if (local.carrier.model !== remote.carrier.model) {
    conflicts.push({
      field: 'carrier.model',
      localValue: local.carrier.model,
      remoteValue: remote.carrier.model
    });
  }

  if (local.carrier.timeout !== remote.carrier.timeout) {
    conflicts.push({
      field: 'carrier.timeout',
      localValue: local.carrier.timeout,
      remoteValue: remote.carrier.timeout
    });
  }

  // Preference conflicts
  const allPrefKeys = new Set([
    ...Object.keys(local.preferences),
    ...Object.keys(remote.preferences)
  ]);

  for (const key of allPrefKeys) {
    const localVal = local.preferences[key];
    const remoteVal = remote.preferences[key];
    if (JSON.stringify(localVal) !== JSON.stringify(remoteVal)) {
      conflicts.push({
        field: `preferences.${key}`,
        localValue: localVal,
        remoteValue: remoteVal
      });
    }
  }

  return conflicts;
}

/**
 * Apply a merge strategy to all conflicts.
 */
export function resolveConflicts(
  conflicts: MergeConflict[],
  strategy: MergeStrategy
): MergeConflict[] {
  return conflicts.map(conflict => ({
    ...conflict,
    strategy,
    resolved: strategy === 'local' ? conflict.localValue : conflict.remoteValue
  }));
}

/**
 * Merge two profiles with resolved conflicts.
 */
export function mergeProfiles(
  local: SyncProfile,
  remote: SyncProfile,
  resolvedConflicts: MergeConflict[]
): SyncProfile {
  const merged = { ...local };

  // Build resolution map
  const resolutions = new Map<string, unknown>();
  for (const conflict of resolvedConflicts) {
    if (conflict.resolved !== undefined) {
      resolutions.set(conflict.field, conflict.resolved);
    }
  }

  // Apply carrier resolutions
  if (resolutions.has('carrier.carrierId')) {
    merged.carrier.carrierId = resolutions.get('carrier.carrierId') as string;
  }
  if (resolutions.has('carrier.model')) {
    merged.carrier.model = resolutions.get('carrier.model') as string;
  }
  if (resolutions.has('carrier.timeout')) {
    merged.carrier.timeout = resolutions.get('carrier.timeout') as number;
  }

  // Apply preference resolutions
  for (const [key, value] of resolutions.entries()) {
    if (key.startsWith('preferences.')) {
      const prefKey = key.replace('preferences.', '');
      merged.preferences[prefKey] = value;
    }
  }

  // Merge plugins (union)
  const pluginSet = new Set([...local.plugins, ...remote.plugins]);
  merged.plugins = Array.from(pluginSet);

  // Merge trusted recipes (union)
  const recipeSet = new Set([...local.trustedRecipes, ...remote.trustedRecipes]);
  merged.trustedRecipes = Array.from(recipeSet);

  return merged;
}

/**
 * Render a conflict summary for terminal display.
 */
export function renderConflictSummary(conflicts: MergeConflict[]): string {
  if (conflicts.length === 0) return '\x1b[32m  No conflicts detected.\x1b[0m';

  const lines: string[] = [
    `\x1b[1;33m  ${conflicts.length} conflict(s) found:\x1b[0m`
  ];

  for (const conflict of conflicts) {
    lines.push(`  \x1b[1;37m${conflict.field}\x1b[0m`);
    lines.push(`    Local:  \x1b[36m${JSON.stringify(conflict.localValue)}\x1b[0m`);
    lines.push(`    Remote: \x1b[35m${JSON.stringify(conflict.remoteValue)}\x1b[0m`);
    if (conflict.resolved !== undefined) {
      lines.push(`    → Resolved: \x1b[32m${JSON.stringify(conflict.resolved)}\x1b[0m (${conflict.strategy})`);
    }
  }

  return lines.join('\n');
}
