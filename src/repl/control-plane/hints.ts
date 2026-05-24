/**
 * @module repl/control-plane/hints
 * @description Contextual hint system for the REPL.
 *
 * Provides inline suggestions, auto-completions, and context-aware
 * hints as the user types.
 */

export interface Hint {
  text: string;
  description: string;
  priority: number;
}

export type HintProvider = (partial: string) => Hint[];

const providers: HintProvider[] = [];

/**
 * Register a hint provider.
 */
export function registerHintProvider(provider: HintProvider): void {
  providers.push(provider);
}

/**
 * Get hints for a partial input.
 */
export function getHints(partial: string, limit: number = 5): Hint[] {
  const all: Hint[] = [];

  for (const provider of providers) {
    try {
      all.push(...provider(partial));
    } catch { /* skip failing providers */ }
  }

  return all
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit);
}

/**
 * Built-in hint provider for slash commands.
 */
export function slashCommandHintProvider(partial: string): Hint[] {
  if (!partial.startsWith('/')) return [];

  const commands = [
    { text: '/help', description: 'Show available commands', priority: 10 },
    { text: '/exit', description: 'Exit the session', priority: 10 },
    { text: '/clear', description: 'Clear the screen', priority: 8 },
    { text: '/reset', description: 'Reset conversation context', priority: 8 },
    { text: '/model', description: 'Change active model', priority: 9 },
    { text: '/models', description: 'List available models', priority: 7 },
    { text: '/carrier', description: 'Show/change carrier', priority: 7 },
    { text: '/status', description: 'Show workspace status', priority: 9 },
    { text: '/resolve', description: 'Resolve drift issues', priority: 6 },
    { text: '/export', description: 'Export workspace files', priority: 5 },
    { text: '/undo', description: 'Restore last transaction', priority: 8 },
    { text: '/dry-run', description: 'Toggle dry-run mode', priority: 7 },
    { text: '/watch', description: 'Toggle watch mode', priority: 7 },
    { text: '/dashboard', description: 'Show dashboard', priority: 6 },
    { text: '/vault', description: 'Manage vault', priority: 5 },
    { text: '/recipe', description: 'Manage recipes', priority: 6 },
    { text: '/plugins', description: 'List plugins', priority: 5 },
    { text: '/memory', description: 'Show session memory', priority: 5 },
    { text: '/pref', description: 'Set preferences', priority: 4 },
    { text: '/theme', description: 'Switch theme', priority: 4 },
    { text: '/config', description: 'Show configuration', priority: 5 },
    { text: '/env', description: 'Show environment', priority: 5 },
  ];

  return commands.filter(c => c.text.startsWith(partial.toLowerCase()));
}

/**
 * Render a hint line for display below the input.
 */
export function renderHintLine(hints: Hint[]): string {
  if (hints.length === 0) return '';

  const parts = hints.map(h =>
    `\x1b[2m${h.text}\x1b[0m \x1b[2;3m${h.description}\x1b[0m`
  );

  return `  ${parts.join('  \x1b[2m│\x1b[0m  ')}`;
}

/**
 * Initialize built-in hint providers.
 */
export function initHints(): void {
  registerHintProvider(slashCommandHintProvider);
}
