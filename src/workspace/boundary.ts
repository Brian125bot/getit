import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { MANIFEST_FILENAME } from './manifest.js';

/**
 * Finds the nearest workspace root by walking up from the start directory
 * looking for the presence of the .getit-manifest.json file.
 */
export function findWorkspaceRoot(startDir: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    const manifestPath = path.join(current, MANIFEST_FILENAME);
    if (fs.existsSync(manifestPath)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

/**
 * Validates if the target path is structurally inside the active workspace boundary,
 * or targets allowlisted locations (e.g. getit config/backup, standard dotfiles in home).
 */
export function isPathInWorkspace(targetPath: string, workspaceRoot: string): boolean {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedRoot = path.resolve(workspaceRoot);

  // If structurally within the workspace root, permit access
  if (resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + path.sep)) {
    return true;
  }

  const homeDir = os.homedir();

  // Allow global getit configuration directory
  const allowedGlobalConfig = path.resolve(path.join(homeDir, '.config/getit'));
  if (resolvedTarget === allowedGlobalConfig || resolvedTarget.startsWith(allowedGlobalConfig + path.sep)) {
    return true;
  }

  // Allow getit backup/tracking state storage
  const allowedBackupRoot = path.resolve(process.env.GETIT_BACKUP_ROOT || path.join(homeDir, '.local/state/getit'));
  if (resolvedTarget === allowedBackupRoot || resolvedTarget.startsWith(allowedBackupRoot + path.sep)) {
    return true;
  }

  // Allow standard direct dotfiles in user's home directory (e.g., ~/.bashrc)
  const relativeToHome = path.relative(homeDir, resolvedTarget);
  const isDirectDotfileInHome = !relativeToHome.includes(path.sep) && relativeToHome.startsWith('.') && relativeToHome !== '.';
  
  if (isDirectDotfileInHome) {
    // Specifically block traversal into sensitive dot directories
    const bannedPrefixes = ['.ssh', '.gnupg', '.aws', '.npm', '.config'];
    if (!bannedPrefixes.some(p => relativeToHome.startsWith(p))) {
      return true;
    }
  }

  return false;
}
