import { assertPathAllowed, resolveRealPath as resolvePolicyRealPath, validatePath } from './path-policy.js';

export function resolveRealPath(targetPath: string): string {
  return resolvePolicyRealPath(targetPath);
}

export function resolvePath(targetPath: string): string {
  return resolveRealPath(targetPath);
}

export function isPathSafe(targetPath: string): boolean {
  return validatePath(targetPath).allowed;
}

export function assertPathSafe(targetPath: string): void {
  assertPathAllowed(targetPath);
}
