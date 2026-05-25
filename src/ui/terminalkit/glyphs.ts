/**
 * @module ui/terminalkit/glyphs
 * @description Unicode glyph library for terminal UI elements.
 *
 * Provides named glyphs with automatic fallback to ASCII when
 * the terminal doesn't support Unicode.
 */
import { getCapabilities } from './capabilities.js';

interface GlyphPair {
  unicode: string;
  ascii: string;
}

const GLYPHS: Record<string, GlyphPair> = {
  // Status
  checkmark: { unicode: '✓', ascii: 'v' },
  cross: { unicode: '✗', ascii: 'x' },
  warning: { unicode: '⚠', ascii: '!' },
  info: { unicode: 'ℹ', ascii: 'i' },
  bullet: { unicode: '●', ascii: '*' },
  circle: { unicode: '○', ascii: 'o' },
  diamond: { unicode: '◆', ascii: '<>' },

  // Arrows
  arrowRight: { unicode: '→', ascii: '->' },
  arrowLeft: { unicode: '←', ascii: '<-' },
  arrowUp: { unicode: '↑', ascii: '^' },
  arrowDown: { unicode: '↓', ascii: 'v' },
  arrowRightFat: { unicode: '❯', ascii: '>' },

  // Box drawing
  boxTopLeft: { unicode: '┌', ascii: '+' },
  boxTopRight: { unicode: '┐', ascii: '+' },
  boxBottomLeft: { unicode: '└', ascii: '+' },
  boxBottomRight: { unicode: '┘', ascii: '+' },
  boxHorizontal: { unicode: '─', ascii: '-' },
  boxVertical: { unicode: '│', ascii: '|' },
  boxCross: { unicode: '┼', ascii: '+' },

  // Double box
  dboxTopLeft: { unicode: '╔', ascii: '+' },
  dboxTopRight: { unicode: '╗', ascii: '+' },
  dboxBottomLeft: { unicode: '╚', ascii: '+' },
  dboxBottomRight: { unicode: '╝', ascii: '+' },
  dboxHorizontal: { unicode: '═', ascii: '=' },
  dboxVertical: { unicode: '║', ascii: '|' },

  // Misc
  ellipsis: { unicode: '…', ascii: '...' },
  lock: { unicode: '🔒', ascii: '[L]' },
  unlock: { unicode: '🔓', ascii: '[U]' },
  key: { unicode: '🔑', ascii: '[K]' },
  gear: { unicode: '⚙', ascii: '[*]' },
  plug: { unicode: '🔌', ascii: '[P]' },
  eye: { unicode: '👁', ascii: '[E]' },
  lightning: { unicode: '⚡', ascii: '!' },
  star: { unicode: '★', ascii: '*' },
  heart: { unicode: '♥', ascii: '<3' },
  fire: { unicode: '🔥', ascii: '(!)' },

  // Progress
  blockFull: { unicode: '█', ascii: '#' },
  blockMedium: { unicode: '▓', ascii: '#' },
  blockLight: { unicode: '░', ascii: '.' },
  blockEmpty: { unicode: '·', ascii: '.' },
};

/**
 * Get a glyph by name, automatically choosing Unicode or ASCII fallback.
 */
export function glyph(name: string): string {
  const pair = GLYPHS[name];
  if (!pair) return '?';

  const caps = getCapabilities();
  return caps.unicode ? pair.unicode : pair.ascii;
}

/**
 * Get all available glyph names.
 */
export function getGlyphNames(): string[] {
  return Object.keys(GLYPHS);
}

/**
 * Render a status indicator glyph.
 */
export function statusGlyph(success: boolean): string {
  return success ? `\x1b[32m${glyph('checkmark')}\x1b[0m` : `\x1b[31m${glyph('cross')}\x1b[0m`;
}

/**
 * Render a severity indicator.
 */
export function severityGlyph(level: 'info' | 'warn' | 'error' | 'success'): string {
  switch (level) {
    case 'success': return `\x1b[32m${glyph('checkmark')}\x1b[0m`;
    case 'warn':    return `\x1b[33m${glyph('warning')}\x1b[0m`;
    case 'error':   return `\x1b[31m${glyph('cross')}\x1b[0m`;
    default:        return `\x1b[36m${glyph('info')}\x1b[0m`;
  }
}
