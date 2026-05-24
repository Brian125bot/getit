/**
 * @module watcher/hooks
 * @description Action hooks triggered by file system watch events.
 *
 * Hooks define what happens when files change. Built-in hooks include
 * build triggers, test runners, and drift detection refreshes.
 */
import type { WatchEvent } from './daemon.js';

export type HookAction = 'build' | 'test' | 'lint' | 'drift-check' | 'custom';

export interface WatchHook {
  /** Unique hook name. */
  name: string;
  /** File patterns that trigger this hook. */
  patterns: string[];
  /** Action to perform. */
  action: HookAction;
  /** Custom command (used when action is 'custom'). */
  command?: string;
  /** Debounce override in milliseconds. */
  debounceMs?: number;
  /** Whether this hook is enabled. */
  enabled: boolean;
}

export interface HookExecutionResult {
  hookName: string;
  success: boolean;
  output: string;
  durationMs: number;
}

/**
 * Default hooks for common project types.
 */
export function getDefaultHooks(): WatchHook[] {
  return [
    {
      name: 'typescript-build',
      patterns: ['**/*.ts', '**/*.tsx'],
      action: 'build',
      enabled: false
    },
    {
      name: 'test-on-change',
      patterns: ['**/*.test.ts', '**/*.spec.ts'],
      action: 'test',
      enabled: false
    },
    {
      name: 'drift-check',
      patterns: ['package.json', '.env', '.gitignore', 'tsconfig.json'],
      action: 'drift-check',
      enabled: true
    }
  ];
}

/**
 * Check if a watch event matches any hook's patterns.
 */
export function matchHook(event: WatchEvent, hooks: WatchHook[]): WatchHook[] {
  return hooks.filter(hook => {
    if (!hook.enabled) return false;
    return hook.patterns.some(pattern => {
      const regexStr = pattern
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]');
      return new RegExp(`^${regexStr}$`).test(event.relativePath);
    });
  });
}

/**
 * Render a hook execution notification for the terminal.
 */
export function renderHookNotification(
  hook: WatchHook,
  event: WatchEvent,
  result: HookExecutionResult
): string {
  const status = result.success ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  const lines = [
    `\x1b[1;35m[watch]\x1b[0m ${status} ${hook.name} triggered by ${event.type}: ${event.relativePath}`,
  ];

  if (!result.success && result.output) {
    lines.push(`  \x1b[31m${result.output.split('\n')[0]}\x1b[0m`);
  }

  lines.push(`  \x1b[2m(${result.durationMs}ms)\x1b[0m`);
  return lines.join('\n');
}
