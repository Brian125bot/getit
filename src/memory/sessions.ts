/**
 * @module memory/sessions
 * @description Persistent session memory for getit v2.0.
 *
 * Stores and retrieves session history across REPL restarts. Sessions are
 * stored as newline-delimited JSON (NDJSON) files in the getit data directory.
 * Each entry records a user prompt, the assistant response summary, tool calls
 * made, and the timestamp.
 *
 * Sessions are keyed by workspace fingerprint so different projects maintain
 * separate histories.
 */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Module-level singleton state (stateful session cache for the running process)
// ---------------------------------------------------------------------------

let _fingerprint: string = '';
let _entries: SessionEntry[] = [];

/** Derive a deterministic 16-char hex fingerprint from a directory path. */
function computeFingerprint(cwd: string): string {
  return crypto.createHash('sha256').update(cwd).digest('hex').slice(0, 16);
}

/**
 * Initialize session memory for the current workspace.
 * Loads existing session entries from disk into the module cache.
 * Call once at startup (does not need to be awaited — graceful degradation if
 * the disk I/O hasn't completed before the first buildSessionContext() call).
 */
export async function initSessionMemory(cwd: string): Promise<void> {
  _fingerprint = computeFingerprint(cwd);
  _entries = await loadSessionEntries(_fingerprint);
}

/**
 * Record a tool call in the current session (stateful convenience wrapper).
 * Used by AgentLoop.runTurn() so it doesn't need to manage fingerprints.
 */
export async function recordToolCall(toolName: string, success: boolean): Promise<void> {
  if (!_fingerprint) return; // Session memory not yet initialized — skip silently
  const entry = await appendSessionEntry(_fingerprint, {
    userPrompt: `[tool] ${toolName}`,
    assistantSummary: success ? `${toolName} succeeded` : `${toolName} failed`,
    toolsUsed: [toolName],
    workingDirectory: process.cwd()
  });
  _entries.push(entry);
  // Enforce 50-entry cap in memory (disk already has the append)
  if (_entries.length > 50) _entries = _entries.slice(-50);
}

export interface SessionEntry {
  id: string;
  timestamp: string;
  userPrompt: string;
  assistantSummary: string;
  toolsUsed: string[];
  workingDirectory: string;
  durationMs?: number;
}

export interface SessionStore {
  fingerprint: string;
  entries: SessionEntry[];
  createdAt: string;
  lastAccessedAt: string;
}

const DATA_DIR = path.join(os.homedir(), '.local', 'state', 'getit', 'sessions');

function getSessionPath(fingerprint: string): string {
  return path.join(DATA_DIR, `${fingerprint}.ndjson`);
}

/**
 * Ensure the sessions directory exists.
 */
async function ensureDir(): Promise<void> {
  await fsp.mkdir(DATA_DIR, { recursive: true });
}

/**
 * Load session entries for a workspace fingerprint.
 * Returns at most `maxEntries` most recent entries.
 */
export async function loadSessionEntries(
  fingerprint: string,
  maxEntries: number = 50
): Promise<SessionEntry[]> {
  await ensureDir();
  const filePath = getSessionPath(fingerprint);

  try {
    const content = await fsp.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const entries: SessionEntry[] = [];

    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch { /* skip malformed lines */ }
    }

    // Return most recent entries
    return entries.slice(-maxEntries);
  } catch {
    return [];
  }
}

/**
 * Append a session entry to the persistent store.
 */
export async function appendSessionEntry(
  fingerprint: string,
  entry: Omit<SessionEntry, 'id' | 'timestamp'>
): Promise<SessionEntry> {
  await ensureDir();
  const filePath = getSessionPath(fingerprint);

  const full: SessionEntry = {
    id: `se_${crypto.randomUUID()}`,
    timestamp: new Date().toISOString(),
    ...entry
  };

  await fsp.appendFile(filePath, JSON.stringify(full) + '\n', 'utf-8');
  return full;
}

/**
 * Build a context summary from recent session entries.
 * Used to inject into the system prompt for continuity.
 */
/**
 * Build a context summary from session entries.
 * When called with no arguments, uses the module-level singleton cache.
 * When called with explicit entries, behaves as a pure function (for tests).
 */
export function buildSessionContext(entries?: SessionEntry[], maxTokenBudget: number = 2000): string {
  const toUse = entries ?? _entries;
  if (toUse.length === 0) return '';

  const lines: string[] = ['## Recent Session History'];
  let charCount = 0;

  // Work backwards from most recent
  const reversed = [...toUse].reverse();

  for (const entry of reversed) {
    const line = `- [${entry.timestamp}] "${entry.userPrompt}" → ${entry.assistantSummary}${entry.toolsUsed.length > 0 ? ` (tools: ${entry.toolsUsed.join(', ')})` : ''}`;
    if (charCount + line.length > maxTokenBudget * 4) break; // rough char-to-token ratio
    lines.push(line);
    charCount += line.length;
  }

  return lines.join('\n');
}

/**
 * Clear all session entries for a workspace.
 */
export async function clearSessionEntries(fingerprint: string): Promise<void> {
  await ensureDir();
  const filePath = getSessionPath(fingerprint);
  try {
    await fsp.unlink(filePath);
  } catch { /* file may not exist */ }
}

/**
 * List all known workspace fingerprints with stored sessions.
 */
export async function listSessionFingerprints(): Promise<string[]> {
  await ensureDir();
  const entries = await fsp.readdir(DATA_DIR);
  return entries
    .filter(e => e.endsWith('.ndjson'))
    .map(e => e.replace(/\.ndjson$/, ''));
}
