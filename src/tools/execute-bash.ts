import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';
import { getSafeEnv } from '../security/env-scrubber.js';
import { sanitizeBashCommand } from '../security/input-sanitizer.js';
import { interceptToolCall } from '../mitl/interceptor.js';
import { assertPathAllowed, resolveRealPath } from '../security/path-policy.js';
import { executeCommandAsync } from '../execution/async-process.js';
import { recordCommand } from '../backup/shadow-store.js';
import { attemptDependencyHealing } from '../workspace/healer.js';

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
  assertPathAllowed(realCwd);

  if (fs.existsSync(realCwd) && fs.statSync(realCwd).isDirectory()) {
    activeCwd = realCwd;
  } else {
    throw new Error(`Directory "${newCwd}" does not exist.`);
  }
}

export interface BashExecutionResult {
  stdout: string;
  stderr: string;
  contextStdout?: string;
  contextStderr?: string;
  exitCode: number;
  haltTurn: boolean;
  error?: string;
}

export async function executeBash(command: string, workingDirectory?: string): Promise<BashExecutionResult> {
  // 1. Resolve stateful working directory if supplied
  if (workingDirectory) {
    try {
      const realWorkingDir = resolveRealPath(workingDirectory);
      assertPathAllowed(realWorkingDir);
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
  
  const result = await executeCommandAsync(approvedCommand, {
    cwd: currentDir,
    env: safeEnv,
    timeoutMs: defaultTimeout
  });

  recordCommand(approvedCommand, currentDir, result.exitCode);

  if (result.exitCode === 0 && !result.timedOut && !result.error) {
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      contextStdout: result.contextStdout,
      contextStderr: result.contextStderr,
      exitCode: 0,
      haltTurn: false
    };
  }

  // Intercept failure for dependency healing
  const healing = attemptDependencyHealing(result.stderr || result.error || '');
  if (healing.matched && healing.command) {
    console.log(`\n\x1b[35m❯ Dependency/Execution Failure Mapped: ${healing.description}\x1b[0m`);
    console.log(`\x1b[35m❯ Mapped Remediation: ${healing.command}\x1b[0m`);
    const healMitl = await interceptToolCall('BASH', healing.command, [`Deterministic dependency healing: ${healing.description}`]);
    if (healMitl.approved) {
      console.log(`\x1b[32m❯ Applying remediation command...\x1b[0m`);
      const healResult = await executeCommandAsync(healMitl.payload, {
        cwd: currentDir,
        env: safeEnv,
        timeoutMs: defaultTimeout
      });
      recordCommand(healMitl.payload, currentDir, healResult.exitCode);
      if (healResult.exitCode === 0) {
        console.log(`\x1b[32m❯ Remediation successful! Re-running original command: ${approvedCommand}\x1b[0m`);
        const retryResult = await executeCommandAsync(approvedCommand, {
          cwd: currentDir,
          env: safeEnv,
          timeoutMs: defaultTimeout
        });
        recordCommand(approvedCommand, currentDir, retryResult.exitCode);
        if (retryResult.exitCode === 0) {
          return {
            stdout: retryResult.stdout,
            stderr: retryResult.stderr,
            contextStdout: retryResult.contextStdout,
            contextStderr: retryResult.contextStderr,
            exitCode: 0,
            haltTurn: false
          };
        } else {
          return {
            stdout: retryResult.stdout,
            stderr: retryResult.stderr,
            contextStdout: retryResult.contextStdout,
            contextStderr: retryResult.contextStderr,
            exitCode: retryResult.exitCode,
            haltTurn: true,
            error: `Retry failed. Stderr: ${retryResult.contextStderr || retryResult.stderr}`
          };
        }
      } else {
        console.log(`\x1b[31m❯ Remediation failed with exit code ${healResult.exitCode}.\x1b[0m`);
      }
    }
  }

  const errMsg = result.error || `Command exited with code ${result.exitCode}.`;
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    contextStdout: result.contextStdout,
    contextStderr: result.contextStderr,
    exitCode: result.exitCode,
    haltTurn: true,
    error: `${errMsg}. Stderr: ${result.contextStderr || result.stderr}`
  };
}
