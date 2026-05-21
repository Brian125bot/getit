import { MaskingSession, scrubText } from '../security/scrubber.js';

export interface LogBufferResult {
  stdout: string;
  stderr: string;
  contextStdout: string;
  contextStderr: string;
}

export class LogBuffer {
  private stdoutChunks: string[] = [];
  private stderrChunks: string[] = [];

  constructor(private maskingSession: MaskingSession) {}

  appendStdout(chunk: string): string {
    const clean = scrubText(chunk, this.maskingSession);
    this.stdoutChunks.push(clean);
    return clean;
  }

  appendStderr(chunk: string): string {
    const clean = scrubText(chunk, this.maskingSession);
    this.stderrChunks.push(clean);
    return clean;
  }

  result(): LogBufferResult {
    const stdout = this.stdoutChunks.join('');
    const stderr = this.stderrChunks.join('');
    return {
      stdout,
      stderr,
      contextStdout: truncateForContext(stdout),
      contextStderr: truncateForContext(stderr)
    };
  }
}

export function approximateTokenCount(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function truncateForContext(text: string, maxTokens = 2000): string {
  if (approximateTokenCount(text) <= maxTokens) return text;

  const lines = text.split(/\r?\n/);
  if (lines.length <= 80) {
    return `${text.slice(0, 3500)}\n[... Dynamic Truncation: ${Math.max(0, text.length - 5000)} characters of log data removed to maintain context ...]\n${text.slice(-1500)}`;
  }

  const first = lines.slice(0, 20);
  const last = lines.slice(-50);
  const removed = Math.max(0, lines.length - first.length - last.length);
  return [
    ...first,
    `[... Dynamic Truncation: ${removed} lines of log data removed to maintain context ...]`,
    ...last
  ].join('\n');
}
