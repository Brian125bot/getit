/**
 * @module ui/terminalkit/animate
 * @description Terminal animation primitives for getit v2.0.
 *
 * Provides non-blocking animation utilities: progress bars, spinners,
 * typing effects, and fade transitions.
 */
import { SGR, cursor, screen } from './ansi.js';
import { getCapabilities } from './capabilities.js';

export interface ProgressBarOptions {
  width: number;
  filled: string;
  empty: string;
  leftBracket: string;
  rightBracket: string;
  showPercent: boolean;
  color: string;
}

const DEFAULT_PROGRESS: ProgressBarOptions = {
  width: 30,
  filled: '█',
  empty: '░',
  leftBracket: '',
  rightBracket: '',
  showPercent: true,
  color: '\x1b[36m'
};

/**
 * Render a progress bar string.
 */
export function renderProgressBar(
  progress: number,
  options: Partial<ProgressBarOptions> = {}
): string {
  const opts = { ...DEFAULT_PROGRESS, ...options };
  const caps = getCapabilities();

  const filled = caps.unicode ? opts.filled : '#';
  const empty = caps.unicode ? opts.empty : '-';

  const clamped = Math.max(0, Math.min(1, progress));
  const filledCount = Math.round(clamped * opts.width);
  const emptyCount = opts.width - filledCount;

  let bar = `${opts.leftBracket}${opts.color}${filled.repeat(filledCount)}${SGR.dim}${empty.repeat(emptyCount)}${SGR.reset}${opts.rightBracket}`;

  if (opts.showPercent) {
    bar += ` ${Math.round(clamped * 100)}%`;
  }

  return bar;
}

/** Spinner frame sets. */
export const SPINNER_FRAMES = {
  dots: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  line: ['-', '\\', '|', '/'],
  arrows: ['←', '↖', '↑', '↗', '→', '↘', '↓', '↙'],
  bouncing: ['⠁', '⠂', '⠄', '⡀', '⢀', '⠠', '⠐', '⠈'],
  pulse: ['◜', '◠', '◝', '◞', '◡', '◟'],
} as const;

/**
 * Creates an animated spinner that renders to stdout.
 */
export class AnimatedSpinner {
  private frames: readonly string[];
  private interval: ReturnType<typeof setInterval> | null = null;
  private frameIndex = 0;
  private message: string;
  private color: string;

  constructor(message: string = '', frameSet: keyof typeof SPINNER_FRAMES = 'dots', color: string = '\x1b[36m') {
    const caps = getCapabilities();
    this.frames = caps.unicode ? SPINNER_FRAMES[frameSet] : SPINNER_FRAMES.line;
    this.message = message;
    this.color = color;
  }

  start(intervalMs: number = 80): void {
    if (this.interval) return;
    this.interval = setInterval(() => {
      const frame = this.frames[this.frameIndex % this.frames.length];
      process.stdout.write(`\r${screen.clearLine}${this.color}${frame}${SGR.reset} ${this.message}`);
      this.frameIndex++;
    }, intervalMs);
  }

  stop(finalMessage?: string): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stdout.write(`\r${screen.clearLine}`);
    if (finalMessage) {
      process.stdout.write(finalMessage + '\n');
    }
  }

  updateMessage(message: string): void {
    this.message = message;
  }
}

/**
 * Render a typing effect (returns an async iterator of partial strings).
 */
export async function* typingEffect(
  text: string,
  charDelayMs: number = 30
): AsyncGenerator<string> {
  let accumulated = '';
  for (const char of text) {
    accumulated += char;
    yield accumulated;
    await new Promise(resolve => setTimeout(resolve, charDelayMs));
  }
}

/**
 * Render a countdown timer string.
 */
export function renderCountdown(remainingMs: number): string {
  const seconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;

  if (minutes > 0) {
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }
  return `${secs}s`;
}
