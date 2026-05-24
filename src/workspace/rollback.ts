import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
const execFile = promisify(execFileCb);
import { getTrackingRoot, scrubContentGeneric, stageToTracking } from './tracking.js';
import { findWorkspaceRoot } from './boundary.js';
import { assertPathAllowed, resolveRealPath } from '../security/path-policy.js';
import { loadWorkspaceManifest, saveWorkspaceManifest, computeScrubbedHash } from './manifest.js';
import { generateDiffPreview } from '../tools/diff.js';
import { getReadlineInterface } from '../mitl/interceptor.js';
import { centerBlock, centerLine, centerPrompt, stripAnsi } from '../ui/layout.js';
import { atomicWriteFile } from './fs-utils.js';

export function isValidCommitHash(hash: string): boolean {
  return /^[a-f0-9]{7,64}$/i.test(hash);
}

export class WorkspaceRollbackManager {
  /**
   * Generates a preview of changes to be applied to the active workspace
   * compared to the state at the requested shadow commit.
   */
  static async previewRollback(commitHash: string, filePath?: string): Promise<string> {
    if (!isValidCommitHash(commitHash)) {
      throw new Error(`Invalid commit hash format: "${commitHash}"`);
    }

    const workspaceRoot = await findWorkspaceRoot(process.cwd());
    if (!workspaceRoot) {
      throw new Error('No active workspace found.');
    }

    const trackingRoot = await getTrackingRoot();
    const manifest = await loadWorkspaceManifest(workspaceRoot);
    const files: string[] = [];

    if (filePath) {
      files.push(await resolveRealPath(filePath));
    } else {
      // Find all files in the tracking repo at this commit
      try {
        const { stdout: output } = await execFile('git', ['ls-tree', '-r', '--name-only', commitHash], {
          cwd: trackingRoot,
          encoding: 'utf-8',
        });
        const relativePaths = output.trim().split('\n').filter(Boolean);
        for (const rel of relativePaths) {
          files.push(path.join(workspaceRoot, rel));
        }
      } catch (err: any) {
        throw new Error(`Failed to list files for commit ${commitHash}: ${err.message}`);
      }

      // Also add any currently tracked files in the manifest that might not be in that commit
      for (const rel of Object.keys(manifest.trackedPaths)) {
        const abs = path.join(workspaceRoot, rel);
        if (!files.includes(abs)) {
          files.push(abs);
        }
      }
    }

    const diffs: string[] = [];

    for (const file of files) {
      const relativePath = path.relative(workspaceRoot, file);
      
      // Enforce boundary check
      await assertPathAllowed(file, { cwd: workspaceRoot });

      // Read live scrubbed content
      let liveScrubbed = '';
      try {
        await fsp.access(file);
        try {
          const liveRaw = await fsp.readFile(file, 'utf-8');
          liveScrubbed = scrubContentGeneric(liveRaw);
        } catch {}
      } catch {}

      // Read content at commit from git tracking shadow repo
      let commitHashVersion = '';
      try {
        const { stdout: chv } = await execFile('git', ['show', `${commitHash}:${relativePath}`], {
          cwd: trackingRoot,
          encoding: 'utf-8',
        });
        commitHashVersion = chv;
      } catch {
        // File did not exist at this commit
      }

      if (liveScrubbed === commitHashVersion) {
        continue;
      }

      // generateDiffPreview(original, modified) -> we show how we go from live to commit version
      const fileDiff = generateDiffPreview(liveScrubbed, commitHashVersion);
      if (fileDiff.trim()) {
        diffs.push(`\x1b[1;36m--- a/${relativePath} (live)\x1b[0m`);
        diffs.push(`\x1b[1;36m+++ b/${relativePath} (commit ${commitHash.substring(0, 7)})\x1b[0m`);
        diffs.push(fileDiff);
        diffs.push('');
      }
    }

    const fullDiff = diffs.join('\n');
    return scrubContentGeneric(fullDiff);
  }

  /**
   * Executes the rollback process, updating live files and manifest.
   */
  static async executeRollback(commitHash: string, filePath?: string): Promise<void> {
    if (!isValidCommitHash(commitHash)) {
      throw new Error(`Invalid commit hash format: "${commitHash}"`);
    }

    const workspaceRoot = await findWorkspaceRoot(process.cwd());
    if (!workspaceRoot) {
      throw new Error('No active workspace found.');
    }

    const trackingRoot = await getTrackingRoot();
    const manifest = await loadWorkspaceManifest(workspaceRoot);
    const files: string[] = [];

    if (filePath) {
      files.push(await resolveRealPath(filePath));
    } else {
      // Find all files in the tracking repo at this commit
      try {
        const { stdout: output } = await execFile('git', ['ls-tree', '-r', '--name-only', commitHash], {
          cwd: trackingRoot,
          encoding: 'utf-8',
        });
        const relativePaths = output.trim().split('\n').filter(Boolean);
        for (const rel of relativePaths) {
          files.push(path.join(workspaceRoot, rel));
        }
      } catch (err: any) {
        throw new Error(`Failed to list files for commit ${commitHash}: ${err.message}`);
      }

      // Also add any currently tracked files in the manifest that might not be in that commit
      for (const rel of Object.keys(manifest.trackedPaths)) {
        const abs = path.join(workspaceRoot, rel);
        if (!files.includes(abs)) {
          files.push(abs);
        }
      }
    }

    // 1. Assert that all target files reside inside valid workspace boundaries using PathPolicy blocks
    for (const file of files) {
      await assertPathAllowed(file, { cwd: workspaceRoot });
    }

    // 2. Interactively prompt the user with a centered card to confirm the rollback (MITL verification)
    const width = 58;
    const top = `\x1b[1;31m╔${'═'.repeat(width - 2)}╗\x1b[0m`;
    const mid = `\x1b[1;31m╟${'─'.repeat(width - 2)}╢\x1b[0m`;
    const bot = `\x1b[1;31m╚${'═'.repeat(width - 2)}╝\x1b[0m`;
    
    const padCenter = (text: string, w: number): string => {
      const visible = stripAnsi(text).length;
      const padding = Math.floor((w - visible) / 2);
      const left = ' '.repeat(Math.max(0, padding));
      const right = ' '.repeat(Math.max(0, w - visible - padding));
      return left + text + right;
    };

    const title = `\x1b[1;31m║\x1b[1;33m${padCenter('⚠️  WARNING: WORKSPACE ROLLBACK', width - 2)}\x1b[1;31m║\x1b[0m`;
    
    const targetDesc = filePath ? filePath : 'All tracked configuration files';
    const lines = [
      `You are about to roll back the workspace to:`,
      `Commit: \x1b[1;37m${commitHash.substring(0, 7)}\x1b[0m`,
      `Target: \x1b[1;37m${targetDesc}\x1b[0m`,
      `This will overwrite live files and manifest!`,
    ];
    
    const formattedLines = lines.map(line => {
      const visibleLength = stripAnsi(line).length;
      const padRight = Math.max(0, (width - 6) - visibleLength);
      return `\x1b[1;31m║\x1b[0m  ${line}${' '.repeat(padRight)}  \x1b[1;31m║\x1b[0m`;
    });
    
    const card = [top, title, mid, ...formattedLines, bot].join('\n');
    console.log('\n' + centerBlock(card) + '\n');

    let proceed = false;
    if (process.env.GETIT_TEST_MODE === 'true') {
      proceed = true;
    } else {
      const rl = getReadlineInterface();
      const prompt = centerPrompt(`\x1b[1;36mConfirm rollback? [y/N] ❯ \x1b[0m`);
      const answer = await rl.question(prompt);
      proceed = answer.trim().toLowerCase() === 'y';
    }

    if (!proceed) {
      console.log(centerLine(`\x1b[33mRollback aborted by user.\x1b[0m`, 27));
      return;
    }

    // 3. Checkout/retrieve state, overwrite live files, update manifest and stage inside shadow tracking
    for (const file of files) {
      const relativePath = path.relative(workspaceRoot, file);
      let contentAtCommit: string | null = null;
      let modeAtCommit: number | null = null;

      try {
        const { stdout: chv } = await execFile('git', ['show', `${commitHash}:${relativePath}`], {
          cwd: trackingRoot,
          encoding: 'utf-8',
        });
        contentAtCommit = chv;

        // Query mode if possible
        const { stdout: lsTree } = await execFile('git', ['ls-tree', commitHash, relativePath], {
          cwd: trackingRoot,
          encoding: 'utf-8',
        });
        const parts = lsTree.trim().split(/\s+/);
        if (parts[0]) {
          modeAtCommit = parseInt(parts[0], 8);
        }
      } catch {
        // File did not exist at commit
      }

      if (contentAtCommit !== null) {
        // Overwrite live workspace file
        await fsp.mkdir(path.dirname(file), { recursive: true });
        await atomicWriteFile(file, contentAtCommit);
        if (modeAtCommit !== null) {
          await fsp.chmod(file, modeAtCommit);
        }

        // Recalculate file hashes and update manifest
        const stat = await fsp.stat(file);
        manifest.trackedPaths[relativePath] = {
          hash: computeScrubbedHash(contentAtCommit),
          mode: stat.mode,
          mtime: stat.mtimeMs
        };

        // Write directly to shadow tracking repo
        const shadowFile = path.join(trackingRoot, relativePath);
        await fsp.mkdir(path.dirname(shadowFile), { recursive: true });
        await atomicWriteFile(shadowFile, contentAtCommit);
        if (modeAtCommit !== null) {
          await fsp.chmod(shadowFile, modeAtCommit);
        }

        // Stage inside shadow repository to preserve tracking state
        await execFile('git', ['add', relativePath], { cwd: trackingRoot });
      } else {
        // File did not exist in the shadow commit. Delete from live workspace.
        try {
          await fsp.access(file);
          await fsp.unlink(file);
        } catch {}
        delete manifest.trackedPaths[relativePath];

        // Delete from tracking repo
        const shadowFile = path.join(trackingRoot, relativePath);
        try {
          await fsp.access(shadowFile);
          await fsp.unlink(shadowFile);
        } catch {}
        try {
          await execFile('git', ['rm', relativePath], { cwd: trackingRoot });
        } catch {
          // Ignore if git rm fails
        }
      }
    }

    // Save active workspace manifest file
    await saveWorkspaceManifest(workspaceRoot, manifest);

    // Commit recovery inside shadow tracking repo to preserve tracking state
    try {
      const { stdout: status } = await execFile('git', ['status', '--porcelain'], { cwd: trackingRoot, encoding: 'utf-8' });
      if (status.trim().length > 0) {
        await execFile('git', ['commit', '-m', `Rollback recovery to commit: ${commitHash.substring(0, 7)}`], {
          cwd: trackingRoot,
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: 'getit-agent',
            GIT_AUTHOR_EMAIL: 'getit@local',
            GIT_COMMITTER_NAME: 'getit-agent',
            GIT_COMMITTER_EMAIL: 'getit@local'
          }
        });
      }
    } catch {
      // Fail silently if git fails
    }

    console.log(centerLine(`\x1b[32m✓ Rollback successfully completed!\x1b[0m`, 36));
  }
}
