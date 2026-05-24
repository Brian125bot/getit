/**
 * @module ui/dashboard
 * @description Rich terminal dashboard for getit v2.0.
 *
 * Provides a multi-pane terminal UI showing:
 * - Active session status
 * - Watch mode events
 * - Plugin status
 * - Memory stats
 * - Recent agent actions
 */
import { stripAnsi, centerBlock } from './layout.js';

export interface DashboardState {
  sessionActive: boolean;
  model: string;
  carrier: string;
  watchActive: boolean;
  watchEvents: number;
  pluginsLoaded: number;
  memoryEntries: number;
  recipeCount: number;
  dryRunActive: boolean;
  policyProfile: string;
  vaultUnlocked: boolean;
  recentActions: DashboardAction[];
}

export interface DashboardAction {
  timestamp: string;
  type: 'tool_call' | 'recipe' | 'plugin' | 'watch_event';
  description: string;
  success: boolean;
}

/**
 * Render the full dashboard as an ANSI string.
 */
export function renderDashboard(state: DashboardState): string {
  const width = 60;
  const h = '═'.repeat(width - 2);
  const hl = '─'.repeat(width - 2);

  const pad = (text: string, w: number): string => {
    const visible = stripAnsi(text).length;
    return text + ' '.repeat(Math.max(0, w - visible));
  };

  const row = (label: string, value: string): string => {
    const content = `  ${label}: ${value}`;
    return `\x1b[1;36m║\x1b[0m${pad(content, width - 2)}\x1b[1;36m║\x1b[0m`;
  };

  const lines: string[] = [];

  // Header
  lines.push(`\x1b[1;36m╔${h}╗\x1b[0m`);
  lines.push(`\x1b[1;36m║\x1b[1;33m${pad('  GETIT DASHBOARD', width - 2)}\x1b[1;36m║\x1b[0m`);
  lines.push(`\x1b[1;36m╟${hl}╢\x1b[0m`);

  // Session info
  lines.push(row('Model', `\x1b[1;37m${state.model}\x1b[0m`));
  lines.push(row('Carrier', `\x1b[1;37m${state.carrier}\x1b[0m`));
  lines.push(row('Policy', `\x1b[1;37m${state.policyProfile}\x1b[0m`));

  const dryRunStr = state.dryRunActive ? '\x1b[1;33mON\x1b[0m' : '\x1b[2moff\x1b[0m';
  lines.push(row('Dry-Run', dryRunStr));

  lines.push(`\x1b[1;36m╟${hl}╢\x1b[0m`);

  // Module status
  const watchStr = state.watchActive
    ? `\x1b[32m● active\x1b[0m (${state.watchEvents} events)`
    : '\x1b[2m○ inactive\x1b[0m';
  lines.push(row('Watch Mode', watchStr));

  lines.push(row('Plugins', `\x1b[1;37m${state.pluginsLoaded}\x1b[0m loaded`));
  lines.push(row('Memory', `\x1b[1;37m${state.memoryEntries}\x1b[0m entries`));
  lines.push(row('Recipes', `\x1b[1;37m${state.recipeCount}\x1b[0m available`));

  const vaultStr = state.vaultUnlocked
    ? '\x1b[32m🔓 unlocked\x1b[0m'
    : '\x1b[33m🔒 locked\x1b[0m';
  lines.push(row('Vault', vaultStr));

  // Recent actions
  if (state.recentActions.length > 0) {
    lines.push(`\x1b[1;36m╟${hl}╢\x1b[0m`);
    lines.push(`\x1b[1;36m║\x1b[1;33m${pad('  RECENT ACTIONS', width - 2)}\x1b[1;36m║\x1b[0m`);

    for (const action of state.recentActions.slice(-5)) {
      const icon = action.success ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
      const desc = action.description.length > 40
        ? action.description.slice(0, 37) + '...'
        : action.description;
      lines.push(`\x1b[1;36m║\x1b[0m  ${icon} ${desc}${' '.repeat(Math.max(0, width - stripAnsi(desc).length - 8))}\x1b[1;36m║\x1b[0m`);
    }
  }

  // Footer
  lines.push(`\x1b[1;36m╚${h}╝\x1b[0m`);

  return lines.join('\n');
}

/**
 * Render a compact status bar for inline display.
 */
export function renderStatusBar(state: DashboardState): string {
  const parts: string[] = [];

  parts.push(`\x1b[36m${state.model}\x1b[0m`);

  if (state.watchActive) parts.push('\x1b[32m👁 watch\x1b[0m');
  if (state.dryRunActive) parts.push('\x1b[33m⚡ dry-run\x1b[0m');
  if (state.vaultUnlocked) parts.push('\x1b[32m🔓\x1b[0m');
  if (state.pluginsLoaded > 0) parts.push(`\x1b[35m🔌 ${state.pluginsLoaded}\x1b[0m`);

  return `\x1b[2m[\x1b[0m${parts.join(' \x1b[2m│\x1b[0m ')}\x1b[2m]\x1b[0m`;
}
