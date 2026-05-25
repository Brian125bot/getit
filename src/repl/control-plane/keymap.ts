/**
 * @module repl/control-plane/keymap
 * @description Keyboard shortcut mapping for the REPL control plane.
 *
 * Maps key sequences (including Ctrl and Alt combinations) to
 * control plane actions.
 */

export type KeyAction =
  | 'submit'
  | 'newline'
  | 'interrupt'
  | 'exit'
  | 'clear_screen'
  | 'history_up'
  | 'history_down'
  | 'cursor_left'
  | 'cursor_right'
  | 'line_start'
  | 'line_end'
  | 'delete_to_end'
  | 'delete_to_start'
  | 'backspace'
  | 'delete_word'
  | 'palette'
  | 'toggle_dashboard'
  | 'tab_complete'
  | 'noop';

export interface KeyBinding {
  /** Raw key sequence string. */
  sequence: string;
  /** Human-readable description. */
  label: string;
  /** The action to perform. */
  action: KeyAction;
}

/**
 * Default keymap bindings.
 */
const DEFAULT_KEYMAP: KeyBinding[] = [
  { sequence: '\r', label: 'Enter', action: 'submit' },
  { sequence: '\n', label: 'Enter', action: 'submit' },
  { sequence: '\x1b\r', label: 'Alt+Enter', action: 'newline' },
  { sequence: '\x1b\n', label: 'Alt+Enter', action: 'newline' },
  { sequence: '\x03', label: 'Ctrl+C', action: 'interrupt' },
  { sequence: '\x04', label: 'Ctrl+D', action: 'exit' },
  { sequence: '\x0c', label: 'Ctrl+L', action: 'clear_screen' },
  { sequence: '\x1b[A', label: 'Up', action: 'history_up' },
  { sequence: '\x1b[B', label: 'Down', action: 'history_down' },
  { sequence: '\x1b[D', label: 'Left', action: 'cursor_left' },
  { sequence: '\x1b[C', label: 'Right', action: 'cursor_right' },
  { sequence: '\x01', label: 'Ctrl+A', action: 'line_start' },
  { sequence: '\x05', label: 'Ctrl+E', action: 'line_end' },
  { sequence: '\x0b', label: 'Ctrl+K', action: 'delete_to_end' },
  { sequence: '\x15', label: 'Ctrl+U', action: 'delete_to_start' },
  { sequence: '\x7f', label: 'Backspace', action: 'backspace' },
  { sequence: '\x08', label: 'Backspace', action: 'backspace' },
  { sequence: '\x17', label: 'Ctrl+W', action: 'delete_word' },
  { sequence: '\x10', label: 'Ctrl+P', action: 'palette' },
  { sequence: '\x02', label: 'Ctrl+B', action: 'toggle_dashboard' },
  { sequence: '\t', label: 'Tab', action: 'tab_complete' },
];

let keymap = [...DEFAULT_KEYMAP];

/**
 * Look up the action for a key sequence.
 */
export function resolveKey(sequence: string): KeyAction {
  const binding = keymap.find(b => b.sequence === sequence);
  return binding?.action || 'noop';
}

/**
 * Get all key bindings.
 */
export function getKeymap(): KeyBinding[] {
  return [...keymap];
}

/**
 * Add or override a key binding.
 */
export function bindKey(sequence: string, action: KeyAction, label: string = ''): void {
  const existing = keymap.findIndex(b => b.sequence === sequence);
  if (existing >= 0) {
    keymap[existing] = { sequence, label: label || keymap[existing].label, action };
  } else {
    keymap.push({ sequence, label: label || sequence, action });
  }
}

/**
 * Remove a key binding.
 */
export function unbindKey(sequence: string): boolean {
  const idx = keymap.findIndex(b => b.sequence === sequence);
  if (idx >= 0) {
    keymap.splice(idx, 1);
    return true;
  }
  return false;
}

/**
 * Reset to default keymap.
 */
export function resetKeymap(): void {
  keymap = [...DEFAULT_KEYMAP];
}

/**
 * Render the keymap help display.
 */
export function renderKeymapHelp(): string {
  const lines: string[] = ['\x1b[1;33m  Keyboard Shortcuts:\x1b[0m'];

  const categories: Record<string, KeyBinding[]> = {};
  for (const binding of keymap) {
    const cat = categorizeAction(binding.action);
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(binding);
  }

  for (const [cat, bindings] of Object.entries(categories)) {
    lines.push(`\n  \x1b[1;36m${cat}\x1b[0m`);
    for (const b of bindings) {
      lines.push(`    \x1b[1;37m${b.label.padEnd(14)}\x1b[0m ${b.action.replace(/_/g, ' ')}`);
    }
  }

  return lines.join('\n');
}

function categorizeAction(action: KeyAction): string {
  if (['submit', 'newline', 'interrupt', 'exit'].includes(action)) return 'Control';
  if (['history_up', 'history_down'].includes(action)) return 'History';
  if (['cursor_left', 'cursor_right', 'line_start', 'line_end'].includes(action)) return 'Navigation';
  if (['backspace', 'delete_to_end', 'delete_to_start', 'delete_word'].includes(action)) return 'Editing';
  return 'UI';
}
