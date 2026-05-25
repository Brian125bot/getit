/**
 * @module repl/control-plane/macros
 * @description User-defined command macros for the REPL.
 *
 * Macros are named shortcuts that expand to one or more commands.
 * For example: `!deploy` → `/recipe run deploy && git push`
 */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

export interface Macro {
  name: string;
  description: string;
  expansion: string;
  createdAt: string;
}

const MACROS_FILE = path.join(os.homedir(), '.config', 'getit', 'macros.json');
let macros: Map<string, Macro> = new Map();

/**
 * Load macros from disk.
 */
export async function loadMacros(): Promise<void> {
  try {
    const content = await fsp.readFile(MACROS_FILE, 'utf-8');
    const data = JSON.parse(content) as Macro[];
    macros = new Map(data.map(m => [m.name, m]));
  } catch {
    macros = new Map();
  }
}

/**
 * Save macros to disk.
 */
async function saveMacros(): Promise<void> {
  const dir = path.dirname(MACROS_FILE);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(MACROS_FILE, JSON.stringify([...macros.values()], null, 2), 'utf-8');
}

/**
 * Define or update a macro.
 */
export async function defineMacro(name: string, expansion: string, description: string = ''): Promise<Macro> {
  const macro: Macro = {
    name,
    description: description || `Expands to: ${expansion}`,
    expansion,
    createdAt: macros.get(name)?.createdAt || new Date().toISOString()
  };

  macros.set(name, macro);
  await saveMacros();
  return macro;
}

/**
 * Delete a macro.
 */
export async function deleteMacro(name: string): Promise<boolean> {
  const deleted = macros.delete(name);
  if (deleted) await saveMacros();
  return deleted;
}

/**
 * Look up a macro by name.
 */
export function getMacro(name: string): Macro | undefined {
  return macros.get(name);
}

/**
 * List all defined macros.
 */
export function listMacros(): Macro[] {
  return [...macros.values()];
}

/**
 * Expand a macro invocation string.
 * Returns the expanded commands, or null if the macro doesn't exist.
 */
export function expandMacro(name: string, args: string = ''): string | null {
  const macro = macros.get(name);
  if (!macro) return null;

  // Replace {args} placeholder in expansion
  let expanded = macro.expansion;
  expanded = expanded.replace(/\{args\}/g, args);

  // Replace numbered placeholders: {0}, {1}, etc.
  const parts = args.split(/\s+/).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    expanded = expanded.replace(new RegExp(`\\{${i}\\}`, 'g'), parts[i]);
  }

  return expanded;
}

/**
 * Render macro list for terminal display.
 */
export function renderMacroList(): string {
  const macroList = listMacros();
  if (macroList.length === 0) {
    return '\x1b[2m  No macros defined. Use /macro define <name> <expansion> to create one.\x1b[0m';
  }

  const lines: string[] = ['\x1b[1;33m  Defined Macros:\x1b[0m'];
  for (const macro of macroList) {
    lines.push(`  \x1b[1;37m!${macro.name}\x1b[0m → \x1b[36m${macro.expansion}\x1b[0m`);
    if (macro.description) {
      lines.push(`    \x1b[2m${macro.description}\x1b[0m`);
    }
  }
  return lines.join('\n');
}
