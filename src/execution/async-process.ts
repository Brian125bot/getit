import { spawn } from 'node:child_process';
import { LogBuffer, LogBufferResult } from './log-buffer.js';
import { getRuntimeSession } from '../runtime/session.js';
import { getSafeEnv } from '../security/env-scrubber.js';

export interface AsyncProcessResult extends LogBufferResult {
  exitCode: number;
  timedOut: boolean;
  error?: string;
}

export interface AsyncProcessOptions {
  cwd: string;
  timeoutMs: number;
  displayOutput?: boolean;
  env?: NodeJS.ProcessEnv;
}

export async function executeCommandAsync(command: string, options: AsyncProcessOptions): Promise<AsyncProcessResult> {
  const session = getRuntimeSession();
  const buffer = new LogBuffer(session.maskingSession);
  const env = options.env || getSafeEnv();
  const displayOutput = options.displayOutput !== false;

  return new Promise((resolve) => {
    session.processActive = true;
    if (process.stdin.isTTY) process.stdin.pause();

    const child = spawn(command, {
      cwd: options.cwd,
      env,
      shell: '/bin/bash',
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let settled = false;
    let timedOut = false;

    const cleanupSignals: Array<() => void> = [];
    const finish = (exitCode: number, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      for (const cleanup of cleanupSignals) cleanup();
      session.processActive = false;
      if (process.stdin.isTTY) process.stdin.resume();
      resolve({ ...buffer.result(), exitCode, timedOut, error });
    };

    const killChild = () => {
      try {
        if (process.platform !== 'win32' && child.pid) {
          process.kill(-child.pid, 'SIGTERM');
        } else {
          child.kill('SIGTERM');
        }
      } catch {
        try { child.kill('SIGTERM'); } catch {}
      }
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      killChild();
    }, options.timeoutMs);

    const forwardSignal = (signal: NodeJS.Signals) => {
      const handler = () => killChild();
      process.once(signal, handler);
      cleanupSignals.push(() => process.off(signal, handler));
    };
    forwardSignal('SIGINT');
    forwardSignal('SIGTERM');

    child.stdout.on('data', (data: Buffer) => {
      const clean = buffer.appendStdout(data.toString('utf-8'));
      if (displayOutput) process.stdout.write(clean);
    });

    child.stderr.on('data', (data: Buffer) => {
      const clean = buffer.appendStderr(data.toString('utf-8'));
      if (displayOutput) process.stderr.write(clean);
    });

    child.on('error', (err) => finish(1, err.message));
    child.on('close', (code, signal) => {
      if (timedOut) {
        finish(code ?? 1, `Command execution timed out after ${options.timeoutMs}ms.`);
      } else if (signal) {
        finish(code ?? 1, `Command terminated by signal ${signal}.`);
      } else {
        finish(code ?? 0);
      }
    });
  });
}
