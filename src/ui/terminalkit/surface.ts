/**
 * @module ui/terminalkit/surface
 * @description Virtual rendering surface for compositing terminal UI.
 *
 * A Surface is a 2D character grid with per-cell style attributes.
 * Multiple surfaces can be composited together before flushing to stdout,
 * enabling double-buffered rendering without flicker.
 */
import { SGR, visibleWidth, stripAnsi } from './ansi.js';
import { getCapabilities } from './capabilities.js';

export interface Cell {
  char: string;
  fg: string;
  bg: string;
  attrs: string;
}

export class Surface {
  readonly width: number;
  readonly height: number;
  private cells: Cell[][];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.cells = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => ({
        char: ' ',
        fg: '',
        bg: '',
        attrs: ''
      }))
    );
  }

  /**
   * Set a single cell.
   */
  setCell(x: number, y: number, char: string, fg: string = '', bg: string = '', attrs: string = ''): void {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      this.cells[y][x] = { char: char[0] || ' ', fg, bg, attrs };
    }
  }

  /**
   * Get a single cell.
   */
  getCell(x: number, y: number): Cell | null {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      return this.cells[y][x];
    }
    return null;
  }

  /**
   * Write a string at position, wrapping styles.
   */
  writeText(x: number, y: number, text: string, fg: string = '', bg: string = '', attrs: string = ''): void {
    const plain = stripAnsi(text);
    for (let i = 0; i < plain.length; i++) {
      this.setCell(x + i, y, plain[i], fg, bg, attrs);
    }
  }

  /**
   * Fill a rectangular region.
   */
  fillRect(x: number, y: number, w: number, h: number, char: string = ' ', fg: string = '', bg: string = ''): void {
    for (let row = y; row < y + h && row < this.height; row++) {
      for (let col = x; col < x + w && col < this.width; col++) {
        this.setCell(col, row, char, fg, bg);
      }
    }
  }

  /**
   * Draw a box (border only).
   */
  drawBox(x: number, y: number, w: number, h: number, fg: string = ''): void {
    const caps = getCapabilities();
    const chars = caps.unicode
      ? { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│' }
      : { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|' };

    // Top edge
    this.setCell(x, y, chars.tl, fg);
    for (let i = 1; i < w - 1; i++) this.setCell(x + i, y, chars.h, fg);
    this.setCell(x + w - 1, y, chars.tr, fg);

    // Sides
    for (let i = 1; i < h - 1; i++) {
      this.setCell(x, y + i, chars.v, fg);
      this.setCell(x + w - 1, y + i, chars.v, fg);
    }

    // Bottom edge
    this.setCell(x, y + h - 1, chars.bl, fg);
    for (let i = 1; i < w - 1; i++) this.setCell(x + i, y + h - 1, chars.h, fg);
    this.setCell(x + w - 1, y + h - 1, chars.br, fg);
  }

  /**
   * Draw a horizontal line.
   */
  drawHLine(x: number, y: number, length: number, fg: string = ''): void {
    const char = getCapabilities().unicode ? '─' : '-';
    for (let i = 0; i < length; i++) {
      this.setCell(x + i, y, char, fg);
    }
  }

  /**
   * Draw a vertical line.
   */
  drawVLine(x: number, y: number, length: number, fg: string = ''): void {
    const char = getCapabilities().unicode ? '│' : '|';
    for (let i = 0; i < length; i++) {
      this.setCell(x, y + i, char, fg);
    }
  }

  /**
   * Composite another surface onto this one at the given offset.
   */
  composite(other: Surface, offsetX: number, offsetY: number): void {
    for (let y = 0; y < other.height; y++) {
      for (let x = 0; x < other.width; x++) {
        const cell = other.getCell(x, y);
        if (cell && cell.char !== ' ') {
          this.setCell(x + offsetX, y + offsetY, cell.char, cell.fg, cell.bg, cell.attrs);
        }
      }
    }
  }

  /**
   * Clear the entire surface.
   */
  clear(): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.cells[y][x] = { char: ' ', fg: '', bg: '', attrs: '' };
      }
    }
  }

  /**
   * Render the surface to a string for terminal output.
   */
  render(): string {
    const lines: string[] = [];

    for (let y = 0; y < this.height; y++) {
      let line = '';
      let prevFg = '';
      let prevBg = '';
      let prevAttrs = '';

      for (let x = 0; x < this.width; x++) {
        const cell = this.cells[y][x];
        let prefix = '';

        if (cell.fg !== prevFg || cell.bg !== prevBg || cell.attrs !== prevAttrs) {
          prefix = SGR.reset;
          if (cell.attrs) prefix += cell.attrs;
          if (cell.fg) prefix += cell.fg;
          if (cell.bg) prefix += cell.bg;
          prevFg = cell.fg;
          prevBg = cell.bg;
          prevAttrs = cell.attrs;
        }

        line += prefix + cell.char;
      }

      lines.push(line + SGR.reset);
    }

    return lines.join('\n');
  }
}
