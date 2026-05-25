/**
 * @module plugins/loader
 * @description Plugin discovery and loading from workspace and global directories.
 *
 * Scans `.getit/tools/` in the workspace root and `~/.config/getit/tools/`
 * for TypeScript plugin files. Compiles them via `tsc` to a temp directory
 * and dynamically imports the result.
 */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import type { PluginToolDefinition } from './types.js';
import { validatePluginDefinition } from './validator.js';

const execFile = promisify(execFileCb);

export interface LoadedPlugin {
  definition: PluginToolDefinition;
  source: 'workspace' | 'global';
  filePath: string;
  loadedAt: number;
}

export interface LoadResult {
  loaded: string[];
  skipped: Array<{ file: string; reason: string }>;
}

/**
 * Discover .ts plugin files in a directory.
 */
async function discoverPluginFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    return entries
      .filter(e => e.isFile() && e.name.endsWith('.ts'))
      .map(e => path.join(dir, e.name));
  } catch {
    return [];
  }
}

/**
 * Compile a TypeScript plugin file to JavaScript using tsc.
 * Falls back to direct JS evaluation if tsc is unavailable.
 */
async function compilePlugin(tsPath: string): Promise<string | null> {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'getit-plugin-'));
  const outFile = path.join(tmpDir, path.basename(tsPath).replace(/\.ts$/, '.js'));

  try {
    // Try tsc compilation
    await execFile('npx', ['tsc', '--outDir', tmpDir, '--module', 'es2022',
      '--moduleResolution', 'node16', '--target', 'es2022', '--esModuleInterop',
      '--declaration', 'false', '--skipLibCheck', tsPath], { timeout: 15000 });
    return outFile;
  } catch {
    // Fallback: strip TypeScript type annotations with a basic transform
    try {
      const content = await fsp.readFile(tsPath, 'utf-8');
      // Simple type-stripping: remove type annotations, interfaces, type aliases
      const stripped = content
        .replace(/:\s*[A-Z]\w*(?:<[^>]+>)?/g, '')
        .replace(/\binterface\s+\w+\s*\{[^}]*\}/gs, '')
        .replace(/\btype\s+\w+\s*=[^;]+;/g, '')
        .replace(/\bexport\s+type\b/g, '// export type')
        .replace(/\bas\s+\w+/g, '')
        .replace(/<[A-Z]\w*(?:,\s*[A-Z]\w*)*>/g, '')
        .replace(/import\s+type\b[^;]+;/g, '');
      await fsp.writeFile(outFile, stripped, 'utf-8');
      return outFile;
    } catch {
      return null;
    }
  }
}

/**
 * Load all plugins from workspace and global directories.
 */
export async function loadAllPlugins(workspaceRoot: string | null): Promise<{
  plugins: LoadedPlugin[];
  result: LoadResult;
}> {
  const result: LoadResult = { loaded: [], skipped: [] };
  const plugins: LoadedPlugin[] = [];
  const loadedNames = new Set<string>();

  // Workspace plugins take precedence
  const workspaceDir = workspaceRoot ? path.join(workspaceRoot, '.getit', 'tools') : null;
  const globalDir = path.join(os.homedir(), '.config', 'getit', 'tools');

  const workspaceFiles = workspaceDir ? await discoverPluginFiles(workspaceDir) : [];
  const globalFiles = await discoverPluginFiles(globalDir);

  // Process workspace plugins first (they take precedence)
  for (const filePath of workspaceFiles) {
    const loaded = await loadSinglePlugin(filePath, 'workspace', loadedNames, result);
    if (loaded) {
      plugins.push(loaded);
      loadedNames.add(loaded.definition.name);
    }
  }

  // Then global plugins (skip duplicates)
  for (const filePath of globalFiles) {
    const loaded = await loadSinglePlugin(filePath, 'global', loadedNames, result);
    if (loaded) {
      plugins.push(loaded);
      loadedNames.add(loaded.definition.name);
    }
  }

  return { plugins, result };
}

async function loadSinglePlugin(
  filePath: string,
  source: 'workspace' | 'global',
  existingNames: Set<string>,
  result: LoadResult
): Promise<LoadedPlugin | null> {
  const fileName = path.basename(filePath);

  try {
    const compiledPath = await compilePlugin(filePath);
    if (!compiledPath) {
      result.skipped.push({ file: fileName, reason: 'Compilation failed.' });
      return null;
    }

    const moduleUrl = pathToFileURL(compiledPath).href;
    const mod = await import(moduleUrl);
    const definition = mod.default || mod;

    const validation = validatePluginDefinition(definition, existingNames);
    if (!validation.valid) {
      result.skipped.push({ file: fileName, reason: validation.errors.join('; ') });
      return null;
    }

    result.loaded.push(definition.name);
    return {
      definition: definition as PluginToolDefinition,
      source,
      filePath,
      loadedAt: Date.now()
    };
  } catch (err: any) {
    result.skipped.push({ file: fileName, reason: err.message || 'Unknown load error' });
    return null;
  }
}
