/**
 * @module repl/control-plane/classifier
 * @description Input classifier for the REPL control plane.
 *
 * Classifies user input into categories: slash commands, natural language
 * prompts, recipe invocations, macro triggers, or control signals.
 */

export type InputCategory =
  | 'slash_command'
  | 'recipe_invoke'
  | 'macro_invoke'
  | 'control_signal'
  | 'natural_language';

export interface ClassifiedInput {
  category: InputCategory;
  raw: string;
  /** Parsed command name (for slash commands). */
  command?: string;
  /** Arguments after the command. */
  args?: string;
  /** Parsed recipe name (for recipe invocations). */
  recipeName?: string;
  /** Parsed macro name (for macro invocations). */
  macroName?: string;
}

/**
 * Classify raw user input.
 */
export function classifyInput(raw: string): ClassifiedInput {
  const trimmed = raw.trim();

  // Empty input
  if (!trimmed) {
    return { category: 'control_signal', raw, command: 'noop' };
  }

  // Slash commands: /command [args]
  if (trimmed.startsWith('/')) {
    const spaceIdx = trimmed.indexOf(' ');
    const command = spaceIdx > 0 ? trimmed.slice(0, spaceIdx) : trimmed;
    const args = spaceIdx > 0 ? trimmed.slice(spaceIdx + 1).trim() : '';
    return { category: 'slash_command', raw, command, args };
  }

  // Recipe invocation: @recipe-name [args]
  if (trimmed.startsWith('@')) {
    const spaceIdx = trimmed.indexOf(' ');
    const recipeName = spaceIdx > 0 ? trimmed.slice(1, spaceIdx) : trimmed.slice(1);
    const args = spaceIdx > 0 ? trimmed.slice(spaceIdx + 1).trim() : '';
    return { category: 'recipe_invoke', raw, recipeName, args };
  }

  // Macro invocation: !macro-name [args]
  if (trimmed.startsWith('!') && /^![a-z][a-z0-9_-]*/.test(trimmed)) {
    const spaceIdx = trimmed.indexOf(' ');
    const macroName = spaceIdx > 0 ? trimmed.slice(1, spaceIdx) : trimmed.slice(1);
    const args = spaceIdx > 0 ? trimmed.slice(spaceIdx + 1).trim() : '';
    return { category: 'macro_invoke', raw, macroName, args };
  }

  // Control signals: Ctrl+C, Ctrl+D sent as special strings
  if (trimmed === '\x03' || trimmed === 'SIGINT') {
    return { category: 'control_signal', raw, command: 'interrupt' };
  }
  if (trimmed === '\x04' || trimmed === 'EOF') {
    return { category: 'control_signal', raw, command: 'exit' };
  }

  // Default: natural language prompt
  return { category: 'natural_language', raw };
}

/**
 * Parse key=value arguments from a string.
 */
export function parseArgs(argsStr: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!argsStr) return result;

  // Match key=value or key="value with spaces"
  const regex = /(\w+)=(?:"([^"]*)"|([\S]+))/g;
  let match;

  while ((match = regex.exec(argsStr)) !== null) {
    result[match[1]] = match[2] || match[3];
  }

  return result;
}

/**
 * Extract positional arguments (non key=value).
 */
export function extractPositionalArgs(argsStr: string): string[] {
  if (!argsStr) return [];
  return argsStr
    .replace(/\w+=(?:"[^"]*"|[\S]+)/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}
