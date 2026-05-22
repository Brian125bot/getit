import { centerLine } from './layout.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INTERVAL_MS = 80;

export class TerminalSpinner {
  private timer: NodeJS.Timeout | null = null;
  private currentFrame = 0;
  private text = '';
  private isRunning = false;

  constructor(initialText: string = '') {
    this.text = initialText;
  }

  public start(text?: string): void {
    if (text) this.text = text;
    if (this.isRunning) return;

    this.isRunning = true;
    this.currentFrame = 0;
    
    // Hide cursor
    process.stdout.write('\x1B[?25l');
    
    this.timer = setInterval(() => {
      this.render();
      this.currentFrame = (this.currentFrame + 1) % FRAMES.length;
    }, INTERVAL_MS);
    
    this.render(); // Initial render
  }

  public update(text: string): void {
    this.text = text;
    if (this.isRunning) {
      this.render();
    }
  }

  public succeed(text?: string): void {
    this.stop(text, '\x1b[32m✔\x1b[0m'); // Green checkmark
  }

  public fail(text?: string): void {
    this.stop(text, '\x1b[31m✖\x1b[0m'); // Red cross
  }

  private stop(text?: string, symbol?: string): void {
    if (!this.isRunning) return;
    
    if (text) this.text = text;
    
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;

    // Clear line
    process.stdout.write('\r\x1B[K');
    
    if (symbol) {
      const line = `${symbol} ${this.text}`;
      process.stdout.write(`${centerLine(line, this.text.length + 2)}\n`);
    }

    // Show cursor
    process.stdout.write('\x1B[?25h');
  }

  private render(): void {
    const frame = FRAMES[this.currentFrame];
    const line = `\x1b[36m${frame}\x1b[0m ${this.text}`;
    
    // Clear line and rewrite
    process.stdout.write('\r\x1B[K');
    process.stdout.write(centerLine(line, this.text.length + 2));
  }
}

// Always restore terminal cursor on process exit to avoid leaving terminal in a bad state
process.on('exit', () => {
  process.stdout.write('\x1B[?25h');
});
