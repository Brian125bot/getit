import test from 'node:test';
import assert from 'node:assert';
import { stripAnsi, getTerminalWidth, getCenterPadding, centerLine, centerBlock, centerPrompt } from '../src/ui/layout.js';

test('UI Layout: stripAnsi removes all terminal styling codes correctly', () => {
  const coloredText = '\x1b[1;36m┌──────────────────┐\x1b[0m';
  const clean = stripAnsi(coloredText);
  assert.strictEqual(clean, '┌──────────────────┐');
});

test('UI Layout: getTerminalWidth returns a valid column number', () => {
  const width = getTerminalWidth();
  assert.ok(typeof width === 'number');
  assert.ok(width > 0);
});

test('UI Layout: getCenterPadding computes accurate space lengths', () => {
  // Test with standard 80 width terminal
  const paddingStandard = getCenterPadding(40, 80);
  assert.strictEqual(paddingStandard, 2);

  // Test with 100 width terminal
  const paddingWide = getCenterPadding(40, 100);
  assert.strictEqual(paddingWide, 2);
});

test('UI Layout: getCenterPadding returns 2 when term width < 60', () => {
  const paddingNarrow = getCenterPadding(20, 50);
  assert.strictEqual(paddingNarrow, 2);
});

test('UI Layout: centerLine pads a single line correctly', () => {
  const line = 'Hello World';
  const centered = centerLine(line, line.length, 80);
  // (80 - 11) / 2 = 34 padding spaces -> now 2
  const expected = '  ' + line;
  assert.strictEqual(centered, expected);
});

test('UI Layout: centerLine falls back to left-aligned when width < 60', () => {
  const line = 'Hello World';
  const centered = centerLine(line, line.length, 50);
  assert.strictEqual(centered, line);
});

test('UI Layout: centerBlock centers a multi-line block based on its longest line', () => {
  const block = [
    'Short line',
    'This is a much longer line in the block',
    'Tiny'
  ].join('\n');

  const longestLineLength = 'This is a much longer line in the block'.length; // 39 characters
  const termWidth = 80;
  // Expected padding is (80 - 39) / 2 = 20 spaces -> now 2
  const padding = '  ';

  const expected = [
    padding + 'Short line',
    padding + 'This is a much longer line in the block',
    padding + 'Tiny'
  ].join('\n');

  const centered = centerBlock(block, termWidth);
  assert.strictEqual(centered, expected);
});

test('UI Layout: centerBlock preserves empty lines exactly without padding them', () => {
  const block = [
    'Line one',
    '',
    'Line two'
  ].join('\n');

  const centered = centerBlock(block, 80);
  const lines = centered.split('\n');
  assert.strictEqual(lines[1], '');
});

test('UI Layout: centerPrompt centers user questions cleanly', () => {
  const prompt = 'Approve? [y/N] ❯ '; // 17 characters
  // Expected padding for 80 terminal is (80 - 17) / 2 = 31 spaces -> now 2
  const centered = centerPrompt(prompt, 80);
  assert.strictEqual(centered, '  ' + prompt);
});
