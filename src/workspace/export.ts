import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { loadWorkspaceManifest } from './manifest.js';
import { scrubContentGeneric } from './tracking.js';
import { resolveLiveFilePath } from './profiles.js';

export interface ExportResult {
  outputDir: string;
  filesExported: string[];
}

/**
 * Exports a scrubbed mirror of all manifest-tracked files to a destination directory.
 * Live files are read, scrubbed, and written — never raw secrets on disk in the export tree.
 */
export async function exportScrubbedWorkspace(
  workspaceRoot: string,
  outputDir?: string
): Promise<ExportResult> {
  const manifest = await loadWorkspaceManifest(workspaceRoot);
  const resolvedOut = outputDir
    ? path.resolve(outputDir)
    : path.join(workspaceRoot, `.getit-export-${Date.now()}`);

  await fsp.mkdir(resolvedOut, { recursive: true });

  const filesExported: string[] = [];

  for (const relPath of Object.keys(manifest.trackedPaths).sort()) {
    const livePath = resolveLiveFilePath(workspaceRoot, relPath);
    try {
      await fsp.access(livePath);
    } catch {
      continue;
    }

    const stat = await fsp.stat(livePath);
    if (!stat.isFile()) {
      continue;
    }

    const raw = await fsp.readFile(livePath, 'utf-8');
    const scrubbed = scrubContentGeneric(raw);
    const targetPath = path.join(resolvedOut, relPath);

    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await fsp.writeFile(targetPath, scrubbed, 'utf-8');
    await fsp.chmod(targetPath, stat.mode);
    filesExported.push(relPath);
  }

  const manifestCopy = {
    exportedAt: new Date().toISOString(),
    fingerprint: manifest.fingerprint,
    fileCount: filesExported.length,
    paths: filesExported
  };
  await fsp.writeFile(
    path.join(resolvedOut, 'export-manifest.json'),
    JSON.stringify(manifestCopy, null, 2),
    'utf-8'
  );

  return { outputDir: resolvedOut, filesExported };
}
