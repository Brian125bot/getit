import { execSync, spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { getSafeEnv } from '../security/env-scrubber.js';
import { sanitizeBashCommand } from '../security/input-sanitizer.js';
import { interceptToolCall } from '../mitl/interceptor.js';
import { assertPathSafe, resolveRealPath } from '../security/banned-paths.js';

// Stateful working directory tracking across asynchronous turns
let activeCwd = process.cwd();
let defaultTimeout = 60000; // Default 60 seconds timeout

export function getActiveCwd(): string {
  return activeCwd;
}

export function setDefaultTimeout(timeoutMs: number): void {
  defaultTimeout = timeoutMs;
}

export function getDefaultTimeout(): number {
  return defaultTimeout;
}

export function setActiveCwd(newCwd: string): void {
  const resolved = newCwd.startsWith('~') 
    ? path.join(os.homedir(), newCwd.slice(1)) 
    : path.resolve(newCwd);
  
  const realCwd = resolveRealPath(resolved);
  assertPathSafe(realCwd);

  if (fs.existsSync(realCwd) && fs.statSync(realCwd).isDirectory()) {
    activeCwd = realCwd;
  } else {
    throw new Error(`Directory "${newCwd}" does not exist.`);
  }
}

export interface BashExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  haltTurn: boolean;
  error?: string;
}

export async function executeBash(command: string, workingDirectory?: string): Promise<BashExecutionResult> {
  // 1. Resolve stateful working directory if supplied
  if (workingDirectory) {
    try {
      const realWorkingDir = resolveRealPath(workingDirectory);
      assertPathSafe(realWorkingDir);
      setActiveCwd(realWorkingDir);
    } catch (e: any) {
      return {
        stdout: '',
        stderr: e.message,
        exitCode: 1,
        haltTurn: true,
        error: e.message
      };
    }
  }

  const currentDir = getActiveCwd();

  // 2. Security: Run input sanitization and warn about cascades
  const sanitization = sanitizeBashCommand(command);

  // 2.5 Pre-execution silent syntax check
  try {
    const syntaxCheck = spawnSync('bash', ['-n', '-c', command], {
      cwd: currentDir,
      timeout: 2000
    });

    if (syntaxCheck.status !== null && syntaxCheck.status !== 0) {
      const stderr = syntaxCheck.stderr ? syntaxCheck.stderr.toString('utf-8') : 'Syntax validation failed';
      return {
        stdout: '',
        stderr,
        exitCode: syntaxCheck.status,
        haltTurn: true,
        error: `Bash syntax validation error: ${stderr.trim()}`
      };
    }
  } catch {
    // Graceful fallback if bash execution or spawnSync fails
  }
  
  // 3. Stage 1: MITL Interceptor
  const mitlResult = await interceptToolCall('BASH', command, sanitization.warnings);
  
  if (!mitlResult.approved) {
    return {
      stdout: '',
      stderr: mitlResult.reason || 'Execution denied by user.',
      exitCode: -1,
      haltTurn: true,
      error: 'Execution denied by user.'
    };
  }

  let approvedCommand = mitlResult.payload;

  // Re-sanitize if user edited the command
  if (approvedCommand !== command) {
    const editSanitization = sanitizeBashCommand(approvedCommand);
    if (!editSanitization.isSafe) {
      console.log('\x1b[33m⚠ Warning: Edited command triggers new shell sanitization warnings:\x1b[0m');
      for (const w of editSanitization.warnings) {
        console.log(`  - \x1b[31m${w}\x1b[0m`);
      }
    }
  }

  // 4. Secrets containment: Execute with sanitized environment
  const safeEnv = getSafeEnv();
  
  try {
    const stdoutBuffer = execSync(approvedCommand, {
      cwd: currentDir,
      env: safeEnv,
      shell: '/bin/bash',
      stdio: 'pipe', // capture both stdout and stderr
      timeout: defaultTimeout,
      maxBuffer: 10 * 1024 * 1024 // 10MB limit to prevent process OOM
    });

    const stdout = stdoutBuffer.toString('utf-8');
    return {
      stdout,
      stderr: '',
      exitCode: 0,
      haltTurn: false
    };
  } catch (error: any) {
    const stderr = error.stderr ? error.stderr.toString('utf-8') : '';
    const stdout = error.stdout ? error.stdout.toString('utf-8') : '';
    const exitCode = error.status !== undefined ? error.status : 1;
    let errMsg = error.message || '';

    if (error.code === 'ETIMEDOUT') {
      errMsg = `Command execution timed out after ${defaultTimeout}ms.`;
    }

    // Fail-Closed: Halts the agent turn immediately, blocking automatic AI recovery
    return {
      stdout,
      stderr,
      exitCode,
      haltTurn: true,
      error: `${errMsg}. Stderr: ${stderr}`
    };
  }
}
