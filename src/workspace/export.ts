import * as fs from 'node:fs';
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
  const manifest = loadWorkspaceManifest(workspaceRoot);
  const resolvedOut = outputDir
    ? path.resolve(outputDir)
    : path.join(workspaceRoot, `.getit-export-${Date.now()}`);

  fs.mkdirSync(resolvedOut, { recursive: true });

  const filesExported: string[] = [];

  for (const relPath of Object.keys(manifest.trackedPaths).sort()) {
    const livePath = resolveLiveFilePath(workspaceRoot, relPath);
    if (!fs.existsSync(livePath)) {
      continue;
    }

    const stat = fs.statSync(livePath);
    if (!stat.isFile()) {
      continue;
    }

    const raw = fs.readFileSync(livePath, 'utf-8');
    const scrubbed = scrubContentGeneric(raw);
    const targetPath = path.join(resolvedOut, relPath);

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, scrubbed, 'utf-8');
    fs.chmodSync(targetPath, stat.mode);
    filesExported.push(relPath);
  }

  const manifestCopy = {
    exportedAt: new Date().toISOString(),
    fingerprint: manifest.fingerprint,
    fileCount: filesExported.length,
    paths: filesExported
  };
  fs.writeFileSync(
    path.join(resolvedOut, 'export-manifest.json'),
    JSON.stringify(manifestCopy, null, 2),
    'utf-8'
  );

  return { outputDir: resolvedOut, filesExported };
}
