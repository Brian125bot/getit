/**
 * @module repl/control-plane/palette
 * @description Command palette for the getit v2.0 control plane.
 *
 * Provides a fuzzy-searchable registry of all available commands,
 * including slash commands, recipes, plugins, and macros.
 */

export interface PaletteEntry {
  /** Unique command identifier. */
  id: string;
  /** Human-readable label shown in palette. */
  label: string;
  /** Description shown alongside the label. */
  description: string;
  /** Category for grouping. */
  category: 'system' | 'carrier' | 'workspace' | 'plugin' | 'recipe' | 'macro' | 'memory';
  /** Keywords for fuzzy search. */
  keywords: string[];
  /** The action to execute (slash command string). */
  action: string;
}

const registry: PaletteEntry[] = [];

/**
 * Register a command in the palette.
 */
export function registerCommand(entry: PaletteEntry): void {
  const existing = registry.findIndex(e => e.id === entry.id);
  if (existing >= 0) {
    registry[existing] = entry;
  } else {
    registry.push(entry);
  }
}

/**
 * Unregister a command from the palette.
 */
export function unregisterCommand(id: string): boolean {
  const idx = registry.findIndex(e => e.id === id);
  if (idx >= 0) {
    registry.splice(idx, 1);
    return true;
  }
  return false;
}

/**
 * Search the palette with fuzzy matching.
 */
export function searchPalette(query: string, limit: number = 10): PaletteEntry[] {
  if (!query) return registry.slice(0, limit);

  const lower = query.toLowerCase();
  const scored = registry.map(entry => ({
    entry,
    score: fuzzyScore(lower, entry)
  }));

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.entry);
}

/**
 * Get all entries in a category.
 */
export function getByCategory(category: PaletteEntry['category']): PaletteEntry[] {
  return registry.filter(e => e.category === category);
}

/**
 * Get all registered commands.
 */
export function getAllCommands(): PaletteEntry[] {
  return [...registry];
}

/**
 * Simple fuzzy scoring: substring matches in label, description, keywords.
 */
function fuzzyScore(query: string, entry: PaletteEntry): number {
  let score = 0;

  // Exact label match
  if (entry.label.toLowerCase() === query) return 100;

  // Label starts with query
  if (entry.label.toLowerCase().startsWith(query)) score += 50;

  // Label contains query
  if (entry.label.toLowerCase().includes(query)) score += 30;

  // Description contains query
  if (entry.description.toLowerCase().includes(query)) score += 10;

  // Keyword matches
  for (const kw of entry.keywords) {
    if (kw.toLowerCase().includes(query)) score += 20;
    if (kw.toLowerCase() === query) score += 40;
  }

  // Character-by-character fuzzy match on label
  if (score === 0) {
    let qi = 0;
    const labelLower = entry.label.toLowerCase();
    for (let i = 0; i < labelLower.length && qi < query.length; i++) {
      if (labelLower[i] === query[qi]) qi++;
    }
    if (qi === query.length) score += 5;
  }

  return score;
}

/**
 * Register all built-in slash commands.
 */
export function registerBuiltinCommands(): void {
  const builtins: Array<Omit<PaletteEntry, 'id'> & { id?: string }> = [
    { label: '/help', description: 'Show available commands', category: 'system', keywords: ['help', 'commands', 'menu'], action: '/help' },
    { label: '/exit', description: 'Exit the agent session', category: 'system', keywords: ['exit', 'quit', 'close'], action: '/exit' },
    { label: '/clear', description: 'Clear the terminal screen', category: 'system', keywords: ['clear', 'cls'], action: '/clear' },
    { label: '/reset', description: 'Clear conversation context', category: 'system', keywords: ['reset', 'fresh', 'new'], action: '/reset' },
    { label: '/env', description: 'Display environment info', category: 'system', keywords: ['environment', 'env', 'info'], action: '/env' },
    { label: '/config', description: 'Show runtime configuration', category: 'system', keywords: ['config', 'settings'], action: '/config' },
    { label: '/carrier', description: 'Show or switch LLM provider', category: 'carrier', keywords: ['carrier', 'provider', 'llm'], action: '/carrier' },
    { label: '/models', description: 'List available models', category: 'carrier', keywords: ['models', 'list', 'model'], action: '/models' },
    { label: '/model', description: 'Display or change active model', category: 'carrier', keywords: ['model', 'switch'], action: '/model' },
    { label: '/status', description: 'Display workspace drift status', category: 'workspace', keywords: ['status', 'drift', 'workspace'], action: '/status' },
    { label: '/resolve', description: 'Interactively resolve drift', category: 'workspace', keywords: ['resolve', 'drift', 'fix'], action: '/resolve' },
    { label: '/export', description: 'Export scrubbed workspace files', category: 'workspace', keywords: ['export', 'scrub'], action: '/export' },
    { label: '/undo', description: 'Restore latest transaction', category: 'system', keywords: ['undo', 'restore', 'rollback'], action: '/undo' },
    { label: '/dry-run', description: 'Toggle dry-run mode', category: 'system', keywords: ['dry', 'preview', 'safe'], action: '/dry-run' },
    { label: '/watch', description: 'Toggle file watch mode', category: 'workspace', keywords: ['watch', 'monitor', 'live'], action: '/watch' },
    { label: '/dashboard', description: 'Show system dashboard', category: 'system', keywords: ['dashboard', 'overview', 'panel'], action: '/dashboard' },
    { label: '/vault', description: 'Manage encrypted vault', category: 'system', keywords: ['vault', 'encrypt', 'secrets', 'keys'], action: '/vault' },
    { label: '/recipe', description: 'Manage task recipes', category: 'recipe', keywords: ['recipe', 'task', 'automation'], action: '/recipe' },
    { label: '/plugins', description: 'List loaded plugins', category: 'plugin', keywords: ['plugins', 'tools', 'extensions'], action: '/plugins' },
    { label: '/memory', description: 'Show session memory', category: 'memory', keywords: ['memory', 'session', 'history'], action: '/memory' },
    { label: '/pref', description: 'Set user preferences', category: 'memory', keywords: ['preference', 'setting', 'config'], action: '/pref' },
    { label: '/theme', description: 'Switch UI theme', category: 'system', keywords: ['theme', 'color', 'dark', 'light'], action: '/theme' },
  ];

  for (const cmd of builtins) {
    registerCommand({ id: cmd.label, ...cmd } as PaletteEntry);
  }
}

/**
 * Render the palette display for terminal output.
 */
export function renderPalette(entries: PaletteEntry[], query: string = ''): string {
  const lines: string[] = [];
  const width = 56;

  lines.push(`\x1b[1;36m┌${'─'.repeat(width - 2)}┐\x1b[0m`);
  lines.push(`\x1b[1;36m│\x1b[1;33m  COMMAND PALETTE${' '.repeat(width - 20)}\x1b[1;36m│\x1b[0m`);
  if (query) {
    lines.push(`\x1b[1;36m│\x1b[0m  Search: \x1b[1;37m${query}\x1b[0m${' '.repeat(Math.max(0, width - 12 - query.length))}\x1b[1;36m│\x1b[0m`);
  }
  lines.push(`\x1b[1;36m├${'─'.repeat(width - 2)}┤\x1b[0m`);

  if (entries.length === 0) {
    lines.push(`\x1b[1;36m│\x1b[2m  No matching commands.${' '.repeat(width - 25)}\x1b[1;36m│\x1b[0m`);
  } else {
    for (const entry of entries) {
      const label = entry.label.padEnd(14);
      const desc = entry.description.length > width - 20
        ? entry.description.slice(0, width - 23) + '...'
        : entry.description;
      const pad = ' '.repeat(Math.max(0, width - 4 - label.length - desc.length));
      lines.push(`\x1b[1;36m│\x1b[0m  \x1b[1;37m${label}\x1b[0m${desc}${pad}\x1b[1;36m│\x1b[0m`);
    }
  }

  lines.push(`\x1b[1;36m└${'─'.repeat(width - 2)}┘\x1b[0m`);
  return lines.join('\n');
}
