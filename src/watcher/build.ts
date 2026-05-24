/**
 * @module watcher/build
 * @description Build integration for watch mode.
 *
 * Detects the project's build system and triggers incremental builds
 * when source files change.
 */
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { HookExecutionResult } from './hooks.js';

const execFile = promisify(execFileCb);

export interface BuildConfig {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}

/**
 * Auto-detect the build command for the project.
 */
export async function detectBuildConfig(rootPath: string): Promise<BuildConfig | null> {
  const exists = async (name: string): Promise<boolean> => {
    try { await fsp.access(path.join(rootPath, name)); return true; } catch { return false; }
  };

  // Check package.json for build script
  if (await exists('package.json')) {
    try {
      const pkg = JSON.parse(await fsp.readFile(path.join(rootPath, 'package.json'), 'utf-8'));
      if (pkg.scripts?.build) {
        // Detect package manager
        let pm = 'npm';
        if (await exists('pnpm-lock.yaml')) pm = 'pnpm';
        else if (await exists('yarn.lock')) pm = 'yarn';
        else if (await exists('bun.lockb')) pm = 'bun';

        return {
          command: pm,
          args: ['run', 'build'],
          cwd: rootPath,
          timeoutMs: 60000
        };
      }
    } catch {}
  }

  // Check for Cargo.toml
  if (await exists('Cargo.toml')) {
    return {
      command: 'cargo',
      args: ['build'],
      cwd: rootPath,
      timeoutMs: 120000
    };
  }

  // Check for go.mod
  if (await exists('go.mod')) {
    return {
      command: 'go',
      args: ['build', './...'],
      cwd: rootPath,
      timeoutMs: 60000
    };
  }

  return null;
}

/**
 * Execute a build using the detected configuration.
 */
export async function executeBuild(config: BuildConfig): Promise<HookExecutionResult> {
  const startTime = Date.now();

  try {
    const { stdout, stderr } = await execFile(config.command, config.args, {
      cwd: config.cwd,
      timeout: config.timeoutMs,
      env: { ...process.env }
    });

    return {
      hookName: 'build',
      success: true,
      output: stdout || stderr || 'Build completed.',
      durationMs: Date.now() - startTime
    };
  } catch (err: any) {
    return {
      hookName: 'build',
      success: false,
      output: err.stderr || err.message || 'Build failed.',
      durationMs: Date.now() - startTime
    };
  }
}
