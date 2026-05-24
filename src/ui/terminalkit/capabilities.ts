/**
 * @module ui/terminalkit/capabilities
 * @description Terminal capability detection for adaptive rendering.
 *
 * Detects the terminal's support for colors, Unicode, mouse events,
 * and other features to enable graceful degradation of UI elements.
 */

export interface TerminalCapabilities {
  /** Whether true color (24-bit) is supported. */
  trueColor: boolean;
  /** Whether 256-color mode is supported. */
  color256: boolean;
  /** Whether basic 16 colors are supported. */
  basicColor: boolean;
  /** Whether Unicode box-drawing characters are supported. */
  unicode: boolean;
  /** Whether the terminal supports the alternate screen buffer. */
  altScreen: boolean;
  /** Terminal width in columns. */
  columns: number;
  /** Terminal height in rows. */
  rows: number;
  /** Whether running inside a CI environment. */
  isCI: boolean;
  /** Whether stdout is a TTY. */
  isTTY: boolean;
  /** Terminal emulator name if detectable. */
  termProgram: string;
}

/**
 * Detect terminal capabilities from environment variables and TTY status.
 */
export function detectCapabilities(): TerminalCapabilities {
  const env = process.env;
  const isTTY = !!process.stdout.isTTY;
  const isCI = !!(env.CI || env.CONTINUOUS_INTEGRATION || env.GITHUB_ACTIONS || env.GITLAB_CI);

  // Color support detection
  const colorTerm = env.COLORTERM || '';
  const term = env.TERM || '';
  const termProgram = env.TERM_PROGRAM || '';

  const trueColor = colorTerm === 'truecolor' || colorTerm === '24bit' ||
    termProgram === 'iTerm.app' || termProgram === 'WezTerm' ||
    termProgram === 'vscode' || term.includes('256color');

  const color256 = trueColor || term.includes('256color') || term === 'xterm';
  const basicColor = isTTY && !isCI;

  // Unicode detection
  const lang = env.LANG || env.LC_ALL || env.LC_CTYPE || '';
  const unicode = lang.toLowerCase().includes('utf') ||
    termProgram === 'iTerm.app' || termProgram === 'WezTerm' ||
    termProgram === 'vscode';

  return {
    trueColor,
    color256,
    basicColor,
    unicode,
    altScreen: isTTY && !isCI,
    columns: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
    isCI,
    isTTY,
    termProgram: termProgram || term || 'unknown'
  };
}

/**
 * Get the appropriate box-drawing character set based on capabilities.
 */
export function getBoxChars(caps: TerminalCapabilities): {
  tl: string; tr: string; bl: string; br: string;
  h: string; v: string; ml: string; mr: string;
  cross: string; tDown: string; tUp: string;
} {
  if (caps.unicode) {
    return {
      tl: '╔', tr: '╗', bl: '╚', br: '╝',
      h: '═', v: '║', ml: '╟', mr: '╢',
      cross: '╬', tDown: '╦', tUp: '╩'
    };
  }
  return {
    tl: '+', tr: '+', bl: '+', br: '+',
    h: '-', v: '|', ml: '+', mr: '+',
    cross: '+', tDown: '+', tUp: '+'
  };
}

/** Singleton cached capabilities. */
let cachedCaps: TerminalCapabilities | null = null;

/**
 * Get cached terminal capabilities (detected once).
 */
export function getCapabilities(): TerminalCapabilities {
  if (!cachedCaps) {
    cachedCaps = detectCapabilities();
  }
  return cachedCaps;
}

/**
 * Force re-detection (e.g., after terminal resize).
 */
export function refreshCapabilities(): TerminalCapabilities {
  cachedCaps = detectCapabilities();
  return cachedCaps;
}
