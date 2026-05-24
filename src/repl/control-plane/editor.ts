/**
 * @module repl/control-plane/editor
 * @description Multi-line input editor for the REPL control plane.
 *
 * Provides a lightweight inline editor that supports:
 * - Multi-line input (Shift+Enter or trailing backslash)
 * - Basic readline-style editing (Ctrl+A, Ctrl+E, Ctrl+K, Ctrl+U)
 * - History navigation with Up/Down arrows
 * - Inline hint rendering
 */

export interface EditorState {
  lines: string[];
  cursorLine: number;
  cursorCol: number;
  historyIndex: number;
  mode: 'normal' | 'multiline';
}

const MAX_HISTORY = 200;
const history: string[] = [];

/**
 * Create a new editor state.
 */
export function createEditorState(): EditorState {
  return {
    lines: [''],
    cursorLine: 0,
    cursorCol: 0,
    historyIndex: -1,
    mode: 'normal'
  };
}

/**
 * Get the current input as a single string.
 */
export function getInput(state: EditorState): string {
  return state.lines.join('\n');
}

/**
 * Check if the input spans multiple lines.
 */
export function isMultiline(state: EditorState): boolean {
  return state.lines.length > 1;
}

/**
 * Insert a character at the cursor position.
 */
export function insertChar(state: EditorState, char: string): void {
  const line = state.lines[state.cursorLine] || '';
  state.lines[state.cursorLine] =
    line.slice(0, state.cursorCol) + char + line.slice(state.cursorCol);
  state.cursorCol += char.length;
}

/**
 * Insert a newline (enter multi-line mode).
 */
export function insertNewline(state: EditorState): void {
  const line = state.lines[state.cursorLine] || '';
  const before = line.slice(0, state.cursorCol);
  const after = line.slice(state.cursorCol);
  state.lines[state.cursorLine] = before;
  state.lines.splice(state.cursorLine + 1, 0, after);
  state.cursorLine++;
  state.cursorCol = 0;
  state.mode = 'multiline';
}

/**
 * Handle backspace at cursor.
 */
export function backspace(state: EditorState): void {
  if (state.cursorCol > 0) {
    const line = state.lines[state.cursorLine] || '';
    state.lines[state.cursorLine] =
      line.slice(0, state.cursorCol - 1) + line.slice(state.cursorCol);
    state.cursorCol--;
  } else if (state.cursorLine > 0) {
    // Merge with previous line
    const prevLine = state.lines[state.cursorLine - 1] || '';
    const curLine = state.lines[state.cursorLine] || '';
    state.lines[state.cursorLine - 1] = prevLine + curLine;
    state.lines.splice(state.cursorLine, 1);
    state.cursorLine--;
    state.cursorCol = prevLine.length;
    if (state.lines.length <= 1) state.mode = 'normal';
  }
}

/**
 * Move cursor left.
 */
export function moveCursorLeft(state: EditorState): void {
  if (state.cursorCol > 0) {
    state.cursorCol--;
  } else if (state.cursorLine > 0) {
    state.cursorLine--;
    state.cursorCol = (state.lines[state.cursorLine] || '').length;
  }
}

/**
 * Move cursor right.
 */
export function moveCursorRight(state: EditorState): void {
  const lineLen = (state.lines[state.cursorLine] || '').length;
  if (state.cursorCol < lineLen) {
    state.cursorCol++;
  } else if (state.cursorLine < state.lines.length - 1) {
    state.cursorLine++;
    state.cursorCol = 0;
  }
}

/**
 * Move to beginning of line (Ctrl+A).
 */
export function moveToLineStart(state: EditorState): void {
  state.cursorCol = 0;
}

/**
 * Move to end of line (Ctrl+E).
 */
export function moveToLineEnd(state: EditorState): void {
  state.cursorCol = (state.lines[state.cursorLine] || '').length;
}

/**
 * Delete from cursor to end of line (Ctrl+K).
 */
export function deleteToEnd(state: EditorState): void {
  const line = state.lines[state.cursorLine] || '';
  state.lines[state.cursorLine] = line.slice(0, state.cursorCol);
}

/**
 * Delete from start to cursor (Ctrl+U).
 */
export function deleteToStart(state: EditorState): void {
  const line = state.lines[state.cursorLine] || '';
  state.lines[state.cursorLine] = line.slice(state.cursorCol);
  state.cursorCol = 0;
}

/**
 * Navigate history up.
 */
export function historyUp(state: EditorState): void {
  if (history.length === 0) return;

  if (state.historyIndex < history.length - 1) {
    state.historyIndex++;
    const entry = history[history.length - 1 - state.historyIndex];
    state.lines = entry.split('\n');
    state.cursorLine = state.lines.length - 1;
    state.cursorCol = (state.lines[state.cursorLine] || '').length;
  }
}

/**
 * Navigate history down.
 */
export function historyDown(state: EditorState): void {
  if (state.historyIndex > 0) {
    state.historyIndex--;
    const entry = history[history.length - 1 - state.historyIndex];
    state.lines = entry.split('\n');
    state.cursorLine = state.lines.length - 1;
    state.cursorCol = (state.lines[state.cursorLine] || '').length;
  } else {
    state.historyIndex = -1;
    state.lines = [''];
    state.cursorLine = 0;
    state.cursorCol = 0;
  }
}

/**
 * Add completed input to history.
 */
export function addToHistory(input: string): void {
  const trimmed = input.trim();
  if (!trimmed) return;
  // Don't add duplicates of the most recent entry
  if (history.length > 0 && history[history.length - 1] === trimmed) return;
  history.push(trimmed);
  if (history.length > MAX_HISTORY) history.shift();
}

/**
 * Get the command history.
 */
export function getHistory(): string[] {
  return [...history];
}

/**
 * Clear the command history.
 */
export function clearHistory(): void {
  history.length = 0;
}

/**
 * Render the editor state for display (with line numbers for multiline).
 */
export function renderEditor(state: EditorState, prompt: string = '❯ '): string {
  if (state.lines.length === 1) {
    return `${prompt}${state.lines[0]}`;
  }

  return state.lines.map((line, i) => {
    const prefix = i === 0 ? prompt : `${'·'.padStart(prompt.length - 1)} `;
    return `${prefix}${line}`;
  }).join('\n');
}
