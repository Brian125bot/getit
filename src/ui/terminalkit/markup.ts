/**
 * @module ui/terminalkit/markup
 * @description Rich text markup parser for inline terminal styling.
 *
 * Supports a simple markup syntax:
 * - `*bold*` → bold text
 * - `_italic_` → italic text
 * - `~dim~` → dim text
 * - `!red!text!` → colored text
 * - `{bg:blue}text{}` → background colored text
 * - Backtick for code spans
 */
import { SGR, FG, BG } from './ansi.js';

const COLOR_MAP: Record<string, string> = {
  red: FG.red, green: FG.green, yellow: FG.yellow, blue: FG.blue,
  magenta: FG.magenta, cyan: FG.cyan, white: FG.white, black: FG.black,
  brightRed: FG.brightRed, brightGreen: FG.brightGreen,
  brightYellow: FG.brightYellow, brightBlue: FG.brightBlue,
  brightMagenta: FG.brightMagenta, brightCyan: FG.brightCyan,
};

const BG_COLOR_MAP: Record<string, string> = {
  red: BG.red, green: BG.green, yellow: BG.yellow, blue: BG.blue,
  magenta: BG.magenta, cyan: BG.cyan, white: BG.white, black: BG.black,
};

/**
 * Parse markup string and return ANSI-styled text.
 */
export function parseMarkup(input: string): string {
  let result = input;

  // Bold: *text*
  result = result.replace(/\*([^*]+)\*/g, `${SGR.bold}$1${SGR.reset}`);

  // Italic: _text_
  result = result.replace(/_([^_]+)_/g, `${SGR.italic}$1${SGR.reset}`);

  // Dim: ~text~
  result = result.replace(/~([^~]+)~/g, `${SGR.dim}$1${SGR.reset}`);

  // Underline: __text__
  result = result.replace(/__([^_]+)__/g, `${SGR.underline}$1${SGR.reset}`);

  // Color: !color!text!
  result = result.replace(/!(\w+)!([^!]+)!/g, (_, color, text) => {
    const ansiColor = COLOR_MAP[color];
    if (ansiColor) return `${ansiColor}${text}${SGR.reset}`;
    return text;
  });

  // Background: {bg:color}text{}
  result = result.replace(/\{bg:(\w+)\}([^{]*)\{\}/g, (_, color, text) => {
    const ansiBg = BG_COLOR_MAP[color];
    if (ansiBg) return `${ansiBg}${text}${SGR.reset}`;
    return text;
  });

  // Code: `text`
  result = result.replace(/`([^`]+)`/g, `${SGR.dim}${FG.green}$1${SGR.reset}`);

  return result;
}

/**
 * Remove all markup tags from a string (returning plain text).
 */
export function stripMarkup(input: string): string {
  return input
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~([^~]+)~/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/!(\w+)!([^!]+)!/g, '$2')
    .replace(/\{bg:(\w+)\}([^{]*)\{\}/g, '$2')
    .replace(/`([^`]+)`/g, '$1');
}
