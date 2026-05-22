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
  const maxVisibleWidth = Math.max(...lines.map(line => stripAnsi(line).length));
  const padding = ' '.repeat(getCenterPadding(maxVisibleWidth, termWidth));
  return lines
    .map(line => {
      // Don't pad empty space lines that are completely empty
      if (line.trim() === '' && stripAnsi(line).length === 0) {
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
  const padding = ' '.repeat(getCenterPadding(visibleLength, termWidth));
  return padding + prompt;
}
