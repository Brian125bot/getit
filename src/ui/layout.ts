import { stdout } from 'node:process';

/**
 * Dynamically queries terminal width with standard fallbacks
 */
export function getTerminalWidth(): number {
  return stdout.columns || 80;
}

/**
 * Safely measures visible character length by stripping ANSI escape sequences
 */
export function stripAnsi(text: string): string {
  // Matches all ANSI escape codes
  return text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

/**
 * Calculates left padding size to center content of given width
 */
export function getCenterPadding(contentWidth: number, termWidth: number = getTerminalWidth()): number {
  if (termWidth < 60) {
    return 0;
  }
  const padding = Math.floor((termWidth - contentWidth) / 2);
  return Math.max(0, padding);
}

/**
 * Centers a single line of text
 */
export function centerLine(line: string, contentWidth: number, termWidth: number = getTerminalWidth()): string {
  if (termWidth < 60) {
    return line;
  }
  const paddingSize = getCenterPadding(contentWidth, termWidth);
  return ' '.repeat(paddingSize) + line;
}

/**
 * Centers a block of multi-line text dynamically based on the longest visible line
 */
export function centerBlock(text: string, termWidth: number = getTerminalWidth()): string {
  if (termWidth < 60) {
    return text;
  }
  const lines = text.split('\n');
  const maxVisibleWidth = Math.max(0, ...lines.map(line => stripAnsi(line).length));
  const paddingSize = getCenterPadding(maxVisibleWidth, termWidth);
  const padding = ' '.repeat(paddingSize);
  return lines
    .map(line => {
      // Don't pad lines that are effectively empty (no visible chars)
      if (stripAnsi(line).length === 0) {
        return line;
      }
      return padding + line;
    })
    .join('\n');
}

/**
 * Centers an interactive input/readline prompt
 */
export function centerPrompt(prompt: string, termWidth: number = getTerminalWidth()): string {
  if (termWidth < 60) {
    return prompt;
  }
  const visibleLength = stripAnsi(prompt).length;
  const paddingSize = getCenterPadding(visibleLength, termWidth);
  const padding = ' '.repeat(paddingSize);
  return padding + prompt;
}

export interface BoxChars {
  tl: string; tr: string; bl: string; br: string;
  h: string; v: string; ml: string; mr: string; mh: string;
}

/**
 * Provides adaptive box characters based on terminal width
 */
export function getBoxChars(termWidth: number = getTerminalWidth(), double: boolean = false): BoxChars {
  if (termWidth < 60) {
    return {
      tl: '+', tr: '+', bl: '+', br: '+',
      h: '-', v: '|', ml: '+', mr: '+', mh: '-'
    };
  }
  if (double) {
    return {
      tl: '╔', tr: '╗', bl: '╚', br: '╝',
      h: '═', v: '║', ml: '╟', mr: '╢', mh: '─'
    };
  }
  return {
    tl: '┌', tr: '┐', bl: '└', br: '┘',
    h: '─', v: '│', ml: '├', mr: '┤', mh: '─'
  };
}
