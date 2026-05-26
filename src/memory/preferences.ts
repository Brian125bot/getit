/**
 * @module memory/preferences
 * @description User preference memory for getit v2.0.
 *
 * Tracks user preferences learned over time: coding style, tool preferences,
 * communication preferences, and safety settings. These are injected into
 * the system prompt to personalize agent behavior.
 */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

export interface UserPreferences {
  /** How the user prefers explanations: 'concise' | 'detailed' | 'auto' */
  verbosity: 'concise' | 'detailed' | 'auto';
  /** Preferred code style markers observed over time. */
  codeStyle: CodeStylePreferences;
  /** Shell environment preferences. */
  shell: ShellPreferences;
  /** Safety-related preferences. */
  safety: SafetyPreferences;
  /** Custom key-value preferences set explicitly by the user. */
  custom: Record<string, string>;
  /** Last time preferences were updated. */
  lastUpdated: string;
}

export interface CodeStylePreferences {
  indentation: 'tabs' | 'spaces' | 'unknown';
  indentSize: number;
  semicolons: boolean;
  quoteStyle: 'single' | 'double' | 'unknown';
  trailingComma: boolean;
}

export interface ShellPreferences {
  preferredShell: string;
  aliases: Record<string, string>;
  envVars: string[];
}

export interface SafetyPreferences {
  autoApproveReads: boolean;
  trustedDirectories: string[];
  blockedCommands: string[];
}

const PREFS_DIR = path.join(os.homedir(), '.config', 'getit');
const PREFS_FILE = path.join(PREFS_DIR, 'preferences.json');

// ---------------------------------------------------------------------------
// Module-level singleton (stateful cache for the running process)
// ---------------------------------------------------------------------------

let _currentPrefs: UserPreferences | null = null;

function defaultPreferences(): UserPreferences {
  return {
    verbosity: 'auto',
    codeStyle: {
      indentation: 'unknown',
      indentSize: 2,
      semicolons: true,
      quoteStyle: 'unknown',
      trailingComma: false
    },
    shell: {
      preferredShell: process.env.SHELL || '/bin/bash',
      aliases: {},
      envVars: []
    },
    safety: {
      autoApproveReads: false,
      trustedDirectories: [],
      blockedCommands: ['rm -rf /', 'mkfs', ':(){:|:&};:']
    },
    custom: {},
    lastUpdated: new Date().toISOString()
  };
}

/**
 * Load user preferences from disk.
 */
/**
 * Load user preferences from disk.
 * Caches the result in module-level state; subsequent synchronous calls to
 * buildPreferencesContext() will use the cached value.
 */
export async function loadPreferences(): Promise<UserPreferences> {
  try {
    const content = await fsp.readFile(PREFS_FILE, 'utf-8');
    const parsed = JSON.parse(content);
    _currentPrefs = { ...defaultPreferences(), ...parsed };
  } catch {
    _currentPrefs = defaultPreferences();
  }
  return _currentPrefs!;
}

/**
 * Save user preferences to disk.
 */
export async function savePreferences(prefs: UserPreferences): Promise<void> {
  await fsp.mkdir(PREFS_DIR, { recursive: true });
  prefs.lastUpdated = new Date().toISOString();
  await fsp.writeFile(PREFS_FILE, JSON.stringify(prefs, null, 2), 'utf-8');
}

/**
 * Update a specific preference key.
 */
export async function updatePreference(
  key: string,
  value: string
): Promise<UserPreferences> {
  const prefs = await loadPreferences();
  prefs.custom[key] = value;
  await savePreferences(prefs);
  return prefs;
}

/**
 * Learn code style from a file's content.
 * Heuristically detects indentation, quotes, semicolons, etc.
 */
export function learnCodeStyleFromContent(content: string): Partial<CodeStylePreferences> {
  const result: Partial<CodeStylePreferences> = {};
  const lines = content.split('\n').slice(0, 100); // Analyze first 100 lines

  // Indentation detection
  let tabCount = 0;
  let spaceCount = 0;
  const spaceSizes: number[] = [];

  for (const line of lines) {
    if (line.startsWith('\t')) tabCount++;
    const leadingSpaces = line.match(/^( +)/);
    if (leadingSpaces) {
      spaceCount++;
      spaceSizes.push(leadingSpaces[1].length);
    }
  }

  if (tabCount > spaceCount) {
    result.indentation = 'tabs';
  } else if (spaceCount > tabCount) {
    result.indentation = 'spaces';
    // Find most common indent size
    const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
    if (spaceSizes.length > 0) {
      const commonSize = spaceSizes.reduce((a, b) => gcd(a, b));
      result.indentSize = commonSize > 0 && commonSize <= 8 ? commonSize : 2;
    }
  }

  // Quote style detection
  const singleQuotes = (content.match(/'/g) || []).length;
  const doubleQuotes = (content.match(/"/g) || []).length;
  if (singleQuotes > doubleQuotes * 1.5) result.quoteStyle = 'single';
  else if (doubleQuotes > singleQuotes * 1.5) result.quoteStyle = 'double';

  // Semicolon detection
  const semiLines = lines.filter(l => l.trimEnd().endsWith(';')).length;
  const nonEmptyLines = lines.filter(l => l.trim().length > 0).length;
  if (nonEmptyLines > 0) {
    result.semicolons = semiLines / nonEmptyLines > 0.3;
  }

  return result;
}

/**
 * Build preferences context string for system prompt injection.
 */
/**
 * Build preferences context string for system prompt injection.
 * When called with no arguments, uses the module-level singleton cache.
 * Falls back to defaultPreferences() so it is always safe to call with no args.
 * When called with explicit prefs, behaves as a pure function (for tests).
 */
export function buildPreferencesContext(prefs?: UserPreferences): string {
  const toUse = prefs ?? _currentPrefs ?? defaultPreferences();
  const lines: string[] = ['## User Preferences'];

  if (toUse.verbosity !== 'auto') {
    lines.push(`- Verbosity: ${toUse.verbosity}`);
  }

  if (toUse.codeStyle.indentation !== 'unknown') {
    lines.push(`- Indentation: ${toUse.codeStyle.indentation}${toUse.codeStyle.indentation === 'spaces' ? ` (${toUse.codeStyle.indentSize})` : ''}`);
  }
  if (toUse.codeStyle.quoteStyle !== 'unknown') {
    lines.push(`- Quote style: ${toUse.codeStyle.quoteStyle}`);
  }

  if (Object.keys(toUse.custom).length > 0) {
    lines.push('\n### Custom Preferences');
    for (const [key, value] of Object.entries(toUse.custom)) {
      lines.push(`- ${key}: ${value}`);
    }
  }

  return lines.length > 1 ? lines.join('\n') : '';
}
