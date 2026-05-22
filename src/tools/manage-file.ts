import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { assertPathAllowed, resolveRealPath } from '../security/path-policy.js';
import { interceptToolCall } from '../mitl/interceptor.js';
import { generateDiffPreview } from './diff.js';
import { snapshotBeforeWrite } from '../backup/shadow-store.js';
import { getRuntimeSession } from '../runtime/session.js';
import { scrubText, MaskingSession } from '../security/scrubber.js';

export interface FileOperationResult {
  success: boolean;
  content?: string;
  metadata?: {
    size: number;
    lines: number;
  };
  error?: string;
}

export async function manageFile(
  action: 'read' | 'create' | 'patch',
  filePath: string,
  content?: string,
  search?: string,
  replace?: string
): Promise<FileOperationResult> {
  try {
    const resolvedPath = resolveRealPath(filePath);
    
    // 1. Safety check
    assertPathAllowed(resolvedPath);

    if (action === 'read') {
      if (!(await pathExists(resolvedPath))) {
        return { success: false, error: `File not found: ${filePath}` };
      }
      const stats = await fsp.stat(resolvedPath);
      if (stats.size > 50 * 1024 * 1024) {
        return { success: false, error: `File is too large (${(stats.size / 1024 / 1024).toFixed(2)}MB). Max supported size is 50MB.` };
      }
      const fileContent = await fsp.readFile(resolvedPath, 'utf-8');
      const lines = fileContent.split(/\r?\n/).length;
      return {
        success: true,
        content: scrubText(fileContent, getRuntimeSession().maskingSession),
        metadata: {
          size: stats.size,
          lines
        }
      };
    }

    if (action === 'create') {
      if (content === undefined) {
        return { success: false, error: 'Mandatory field "content" missing for "create" action.' };
      }

      // Ensure containing directory path is safe
      const dirName = path.dirname(resolvedPath);
      assertPathAllowed(dirName);

      // Stage 1: MITL Gate
      const warnings: string[] = [];
      const scanSession = new MaskingSession();
      const scrubbed = scrubText(content, scanSession);
      if (scrubbed !== content) {
        warnings.push("PRE-WRITE SECRET DETECTED: This file content contains raw credentials or a high-entropy secret (will be scrubbed to [REDACTED_SECRET] in tracking mirror)!");
      }
      const mitlResult = await interceptToolCall('FILE CREATE', content, warnings);
      if (!mitlResult.approved) {
        return { success: false, error: 'File creation denied by user.' };
      }

      // Ensure containing directory exists (defer until approved)
      if (!(await pathExists(dirName))) {
        await fsp.mkdir(dirName, { recursive: true });
      }

      const finalContent = mitlResult.payload;
      snapshotBeforeWrite(resolvedPath, 'file_create');
      await atomicWriteFile(resolvedPath, finalContent);

      return {
        success: true,
        metadata: {
          size: Buffer.byteLength(finalContent),
          lines: finalContent.split(/\r?\n/).length
        }
      };
    }

    if (action === 'patch') {
      if (search === undefined || replace === undefined) {
        return { success: false, error: 'Mandatory fields "search" and "replace" missing for "patch" action.' };
      }

      if (!(await pathExists(resolvedPath))) {
        return { success: false, error: `File to patch not found: ${filePath}` };
      }

      const existingContent = await fsp.readFile(resolvedPath, 'utf-8');

      // Verify search block exists uniquely
      const occurrences = existingContent.split(search).length - 1;
      if (occurrences === 0) {
        return {
          success: false,
          error: `Search block not found in "${filePath}". Ensure exact matches including whitespace and newlines.`
        };
      }
      if (occurrences > 1) {
        return {
          success: false,
          error: `Multiple occurrences (${occurrences}) of search block found in "${filePath}". Make your search block more specific.`
        };
      }

      // Perform substitution
      const modifiedContent = existingContent.replace(search, replace);

      // Programmatically calculate a line-by-line visual diff
      const diffPreview = generateDiffPreview(existingContent, modifiedContent);

      // Print diff preview
      console.log(`\n\x1b[1;36mProposed Unified Diff for ${filePath}:\x1b[0m`);
      console.log(diffPreview);

      // Stage 1: MITL Gate (pass modifiedContent as the edit payload)
      const warnings: string[] = [];
      const scanSession = new MaskingSession();
      const scrubbed = scrubText(modifiedContent, scanSession);
      if (scrubbed !== modifiedContent) {
        warnings.push("PRE-WRITE SECRET DETECTED: This file content contains raw credentials or a high-entropy secret (will be scrubbed to [REDACTED_SECRET] in tracking mirror)!");
      }
      const mitlResult = await interceptToolCall('FILE PATCH', diffPreview, warnings, modifiedContent);
      if (!mitlResult.approved) {
        return { success: false, error: 'File patching denied by user.' };
      }

      let finalContent = modifiedContent;
      if (mitlResult.payload !== diffPreview) {
        finalContent = mitlResult.payload;
      }

      snapshotBeforeWrite(resolvedPath, 'file_patch');
      await atomicWriteFile(resolvedPath, finalContent);

      return {
        success: true,
        metadata: {
          size: Buffer.byteLength(finalContent),
          lines: finalContent.split(/\r?\n/).length
        }
      };
    }

    return { success: false, error: `Unknown action: ${action}` };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.getit-tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(tempPath, content, 'utf-8');
  await fsp.rename(tempPath, filePath);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fsp.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
