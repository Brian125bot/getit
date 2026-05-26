import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { 
  SGR, FG, BG, fg256, bg256, fgRgb, bgRgb, stripAnsi, visibleWidth, styled, truncate 
} from '../src/ui/terminalkit/ansi.js';

describe('UI TerminalKit ANSI', () => {
  it('UIK_001: should export basic SGR constants', () => {
    assert.equal(SGR.reset, '\x1b[0m');
    assert.equal(SGR.bold, '\x1b[1m');
  });

  it('UIK_002: should export basic foreground colors', () => {
    assert.equal(FG.red, '\x1b[31m');
    assert.equal(FG.green, '\x1b[32m');
  });

  it('UIK_003: should generate 256-color sequences', () => {
    assert.equal(fg256(128), '\x1b[38;5;128m');
    assert.equal(bg256(128), '\x1b[48;5;128m');
  });

  it('UIK_004: should generate truecolor rgb sequences', () => {
    assert.equal(fgRgb(255, 128, 64), '\x1b[38;2;255;128;64m');
    assert.equal(bgRgb(255, 128, 64), '\x1b[48;2;255;128;64m');
  });

  it('UIK_005: should strip ansi escape codes', () => {
    const ansiText = `\x1b[31mRed \x1b[1mBold\x1b[0m`;
    const plain = stripAnsi(ansiText);
    assert.equal(plain, 'Red Bold');
  });

  it('UIK_006: should calculate visible width correctly', () => {
    const ansiText = `\x1b[31mRed \x1b[1mBold\x1b[0m`;
    const width = visibleWidth(ansiText);
    assert.equal(width, 8); // "Red Bold".length
  });

  it('UIK_007: should apply styles and reset', () => {
    const styledText = styled('hello', FG.red, SGR.bold);
    assert.equal(styledText, '\x1b[31m\x1b[1mhello\x1b[0m');
  });

  it('UIK_008: should truncate text to visible width', () => {
    const ansiText = `\x1b[31mRed \x1b[1mBold\x1b[0m`;
    const trunc1 = truncate(ansiText, 3);
    assert.equal(stripAnsi(trunc1), 'Re…');
    
    const trunc2 = truncate(ansiText, 8);
    assert.equal(stripAnsi(trunc2), 'Red Bold');
  });
});
