/**
 * @module ui/terminalkit/ansi
 * @description Low-level ANSI escape sequence utilities for the TerminalKit UI shell.
 *
 * Provides composable ANSI primitives for colors, styles, cursor movement,
 * and screen control. Zero dependencies — uses raw escape codes.
 */

/** ANSI SGR (Select Graphic Rendition) codes. */
export const SGR = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  blink: '\x1b[5m',
  inverse: '\x1b[7m',
  hidden: '\x1b[8m',
  strikethrough: '\x1b[9m',
} as const;

/** Standard foreground colors. */
export const FG = {
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  default: '\x1b[39m',
  // Bright variants
  brightBlack: '\x1b[90m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',
} as const;

/** Standard background colors. */
export const BG = {
  black: '\x1b[40m',
  red: '\x1b[41m',
  green: '\x1b[42m',
  yellow: '\x1b[43m',
  blue: '\x1b[44m',
  magenta: '\x1b[45m',
  cyan: '\x1b[46m',
  white: '\x1b[47m',
  default: '\x1b[49m',
  // Bright variants
  brightBlack: '\x1b[100m',
  brightRed: '\x1b[101m',
  brightGreen: '\x1b[102m',
  brightYellow: '\x1b[103m',
  brightBlue: '\x1b[104m',
  brightMagenta: '\x1b[105m',
  brightCyan: '\x1b[106m',
  brightWhite: '\x1b[107m',
} as const;

/** 256-color support. */
export function fg256(n: number): string { return `\x1b[38;5;${n}m`; }
export function bg256(n: number): string { return `\x1b[48;5;${n}m`; }

/** 24-bit true color support. */
export function fgRgb(r: number, g: number, b: number): string { return `\x1b[38;2;${r};${g};${b}m`; }
export function bgRgb(r: number, g: number, b: number): string { return `\x1b[48;2;${r};${g};${b}m`; }

/** Cursor movement. */
export const cursor = {
  up: (n: number = 1) => `\x1b[${n}A`,
  down: (n: number = 1) => `\x1b[${n}B`,
  forward: (n: number = 1) => `\x1b[${n}C`,
  back: (n: number = 1) => `\x1b[${n}D`,
  moveTo: (row: number, col: number) => `\x1b[${row};${col}H`,
  savePosition: '\x1b[s',
  restorePosition: '\x1b[u',
  hide: '\x1b[?25l',
  show: '\x1b[?25h',
  home: '\x1b[H',
} as const;

/** Screen control. */
export const screen = {
  clear: '\x1b[2J',
  clearLine: '\x1b[2K',
  clearToEnd: '\x1b[0K',
  clearToStart: '\x1b[1K',
  clearDown: '\x1b[0J',
  clearUp: '\x1b[1J',
  scrollUp: (n: number = 1) => `\x1b[${n}S`,
  scrollDown: (n: number = 1) => `\x1b[${n}T`,
  enableAltBuffer: '\x1b[?1049h',
  disableAltBuffer: '\x1b[?1049l',
} as const;

/**
 * Strip all ANSI escape sequences from a string.
 */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

/**
 * Calculate the visible (printed) width of a string.
 */
export function visibleWidth(text: string): number {
  return stripAnsi(text).length;
}

/**
 * Compose multiple style codes into a single string.
 */
export function style(...codes: string[]): string {
  return codes.join('');
}

/**
 * Apply style to text and reset afterwards.
 */
export function styled(text: string, ...codes: string[]): string {
  return `${codes.join('')}${text}${SGR.reset}`;
}

/**
 * Truncate a string to a visible width, preserving ANSI codes.
 */
export function truncate(text: string, maxWidth: number, suffix: string = '…'): string {
  const plain = stripAnsi(text);
  if (plain.length <= maxWidth) return text;

  let visible = 0;
  let i = 0;
  let inEscape = false;
  const targetWidth = maxWidth - suffix.length;

  while (i < text.length && visible < targetWidth) {
    if (text[i] === '\x1b') inEscape = true;
    if (!inEscape) visible++;
    if (inEscape && /[A-Za-z]/.test(text[i])) inEscape = false;
    i++;
  }

  return text.slice(0, i) + SGR.reset + suffix;
}
