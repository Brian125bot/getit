# getit v2.0 — Complete Engineering Specification

**Status:** Draft — Source of Truth for Implementation  
**Author:** Viktor AI (Product Engineering)  
**Base Version:** v1.5.0 (commit `v1.5`)  
**Target:** v2.0.0  
**Constraint:** Zero production dependencies. Node.js ≥ 20 native modules only.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architectural Philosophy](#2-architectural-philosophy)
3. [Module A — Plugin Tool Registry](#3-module-a--plugin-tool-registry)
4. [Module B — Persistent Session Memory](#4-module-b--persistent-session-memory)
5. [Module C — Task Recipes](#5-module-c--task-recipes)
6. [Module D — Watch Mode](#6-module-d--watch-mode)
7. [Module E — Rich Terminal Dashboard](#7-module-e--rich-terminal-dashboard)
8. [Module F — Multi-Machine Sync](#8-module-f--multi-machine-sync)
8b. [Module G — Custom Themable UI Shell (TerminalKit)](#8b-module-g--custom-themable-ui-shell-terminalkit)
8c. [Module H — Enhanced CLI Control Plane & UX](#8c-module-h--enhanced-cli-control-plane--ux)
8d. [Module I — OpenRouter Free-Model Auto-Switcher](#8d-module-i--openrouter-free-model-auto-switcher)
9. [Cross-Cutting Concerns](#9-cross-cutting-concerns)
10. [Migration from v1.5](#10-migration-from-v15)
11. [Implementation Roadmap](#11-implementation-roadmap)
12. [Complete Acceptance Test Matrix](#12-complete-acceptance-test-matrix)

---

## 1. Executive Summary

getit v2.0 evolves the project from a reactive, session-stateless command executor into a **stateful, extensible workspace brain** — one that remembers context across sessions, accepts user-authored tool plugins, composes multi-step automations, and watches for problems proactively.

### Core Tenets Preserved

| Tenet | v1.5 Implementation | v2.0 Extension |
|---|---|---|
| Zero Dependencies | 0 production deps | Still 0. All new features use `node:*` built-in modules. |
| Man-in-the-Loop | `[Y/n/e/c]` gate on every mutation | Gate extends to plugin tools. New `trust` levels for plugins. |
| Fail-Closed | Non-zero exit halts turn | Plugin crashes are sandboxed; agent turn continues with error context. |
| Deterministic State | SHA-256 manifest tracking | Session memory, plugin registry, and recipes all use hashed JSON stores. |

### What Ships in v2.0

| Module | Deliverable | New Files |
|---|---|---|
| A — Plugin Registry | User-authored tools loaded from `.getit/tools/` | `src/plugins/*`, `.getit/tools/` convention |
| B — Session Memory | Scrubbed conversation summaries + project context + preference learning | `src/memory/*` |
| C — Task Recipes | `.getit-task.yaml` composable automation files | `src/recipes/*` |
| D — Watch Mode | `fs.watch`-based file monitoring, build watcher, drift sentinel | `src/watcher/*` |
| E — Rich TUI | Split-pane terminal dashboard with persistent status bar | `src/ui/dashboard.ts`, `src/ui/panes.ts` |
| F — Multi-Machine Sync | Encrypted vault, 3-way merge, profile-based sync | `src/sync/*`, `src/vault/*` |
| G — TerminalKit UI Shell | Custom themable TUI primitives, palettes, glyph sets, animations, accessibility | `src/ui/terminalkit/*`, `.getit/themes/` |
| H — Control Plane & UX | Command palette, fuzzy completion, contextual hints, REPL macros, inline editor, undo timeline | `src/repl/control-plane/*` |
| I — OpenRouter Free-Model Auto-Switcher | Live free-tier catalog, capability-aware routing, automatic fallback, cost/latency telemetry | `src/carriers/openrouter/router.ts`, `src/carriers/openrouter/catalog.ts` |

---

## 2. Architectural Philosophy

### 2.1 The Plugin-First Principle

v2.0 introduces a single foundational change: **the tool system becomes extensible**. In v1.5, `src/tools/registry.ts` hard-codes two tool handlers:

```typescript
// v1.5 — src/tools/registry.ts (current)
if (name === 'execute_bash') { ... }
if (name === 'manage_file') { ... }
```

In v2.0, the registry becomes a dynamic dispatch table. The two built-in tools remain as first-class entries, but any TypeScript file dropped into `.getit/tools/` is automatically loaded, validated, and registered into the LLM's tool schema array.

This is the keystone: Task Recipes (Module C) and Watch Mode (Module D) are themselves implemented as tools that plugins can extend. The architecture eats its own tail.

### 2.2 Security Model Extension

Every new surface must pass through the existing three-layer security pipeline:

```
Plugin Tool Output → Input Sanitizer → Scrubber → MITL Gate → Execution
```

Plugins declare a `risk` level (`read`, `write`, `system`) that determines MITL behavior:

| Risk Level | MITL Behavior | Example |
|---|---|---|
| `read` | Auto-approved (no MITL prompt). Scrubbed before reaching LLM context. | `read_url`, `list_directory` |
| `write` | Standard `[Y/n/e/c]` approval gate. | `write_json`, `http_post` |
| `system` | Enhanced gate with red warning banner. Cannot be auto-trusted. | `install_package`, `modify_cron` |

### 2.3 State Architecture

v2.0 introduces persistent state across four domains, all stored under `~/.local/state/getit/`:

```
~/.local/state/getit/
├── tracking/          # (v1.5) Scrubbed shadow Git repo
├── snapshots/         # (v1.5) Ledger-backed file snapshots
├── memory/            # (v2.0) Session summaries, project context, preferences
│   ├── sessions/      #         Compressed session transcripts
│   ├── projects/      #         Per-workspace project fingerprints
│   └── preferences/   #         Learned user approval patterns
├── vault/             # (v2.0) AES-256-GCM encrypted secrets store
└── plugins/           # (v2.0) Plugin registry metadata cache
```

All state files are JSON. All state files containing conversation content pass through `scrubText()` before serialization. The `vault/` directory is the sole exception — it stores encrypted blobs, not cleartext.

---

## 3. Module A — Plugin Tool Registry

### 3.1 Context & Rationale

v1.5 has exactly two tools: `execute_bash` and `manage_file`. Every capability the agent offers must be expressed as a shell command or a file operation. This forces the LLM to chain complex operations through bash — increasing security surface area, introducing shell-parsing ambiguity, and making the system prompt longer with workarounds.

A plugin system allows atomic, typed, purpose-built tools that the LLM can call directly. Each plugin is a single TypeScript file with a standardized export shape. No bundlers, no package managers, no build step — just `tsc`-compatible TypeScript that getit compiles at load time using Node's native module resolution.

### 3.2 Plugin File Convention

Plugins live in the workspace-local `.getit/tools/` directory or the global `~/.config/getit/tools/` directory. Workspace plugins take precedence over global plugins with the same name.

```
.getit/tools/
├── read-url.ts
├── list-packages.ts
└── http-post.ts

~/.config/getit/tools/
├── search-docs.ts
└── git-status.ts
```

### 3.3 Plugin Interface

Each plugin exports a default object conforming to `PluginToolDefinition`:

```typescript
// src/plugins/types.ts

/**
 * Risk classification for plugin MITL behavior.
 * - 'read'   — Auto-approved. Output is scrubbed before LLM context.
 * - 'write'  — Standard [Y/n/e/c] MITL gate.
 * - 'system' — Enhanced MITL gate with red warning. Cannot be auto-trusted.
 */
export type PluginRiskLevel = 'read' | 'write' | 'system';

/**
 * JSON Schema subset for parameter definitions.
 * Uses the same shape as OpenAI function calling parameter schemas.
 */
export interface PluginParameterSchema {
  type: 'object';
  properties: Record<string, {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    description: string;
    enum?: string[];
    items?: { type: string };
    default?: unknown;
  }>;
  required?: string[];
}

/**
 * The result shape returned by every plugin execution.
 */
export interface PluginExecutionResult {
  /** Serializable output sent to the LLM as tool response content. */
  output: unknown;
  /** If true, halts the agent turn (fail-closed behavior). */
  halt?: boolean;
  /** Optional clarification request routed back to the user. */
  clarify?: string;
}

/**
 * The contract every plugin tool must satisfy.
 */
export interface PluginToolDefinition {
  /** Unique tool name. Must match /^[a-z][a-z0-9_]{1,63}$/ */
  name: string;
  /** Human-readable description injected into the LLM tool schema. Max 500 chars. */
  description: string;
  /** JSON Schema for the tool's parameters. */
  parameters: PluginParameterSchema;
  /** Risk level determining MITL gate behavior. */
  risk: PluginRiskLevel;
  /** The execution function. Receives validated args, returns structured result. */
  execute: (args: Record<string, unknown>) => Promise<PluginExecutionResult>;
  /**
   * Optional MITL display formatter.
   * If provided, generates the human-readable string shown in the MITL approval card.
   * If omitted, a default JSON.stringify of args is shown.
   */
  formatApprovalCard?: (args: Record<string, unknown>) => string;
  /**
   * Optional validation function run before MITL gate.
   * Throw an Error to reject the call before it reaches the user.
   */
  validate?: (args: Record<string, unknown>) => void | Promise<void>;
}
```

### 3.4 Plugin Loader (`src/plugins/loader.ts`)

#### 3.4.1 Discovery

On startup (and on `/plugins reload` REPL command), the loader:

1. Scans `.getit/tools/*.ts` in the active workspace root (found via `findWorkspaceRoot()`).
2. Scans `~/.config/getit/tools/*.ts` for global plugins.
3. For each file, compiles TypeScript to JavaScript using `node:vm` with `--experimental-vm-modules` **or** by invoking `tsc` as a child process targeting a temp directory. The loader must support both strategies with automatic fallback.

#### 3.4.2 Validation

Each loaded module must:

- Export a default object matching `PluginToolDefinition`.
- Have a `name` matching `/^[a-z][a-z0-9_]{1,63}$/`.
- Not collide with built-in tool names (`execute_bash`, `manage_file`).
- Not collide with another loaded plugin name (workspace wins over global).
- Have `description` ≤ 500 characters.
- Have `parameters.type === 'object'`.

Validation failures emit a warning to stderr and skip the plugin. They never crash the startup sequence.

#### 3.4.3 Registration

Valid plugins are registered into a `PluginRegistry` singleton:

```typescript
// src/plugins/registry.ts

export class PluginRegistry {
  private plugins: Map<string, LoadedPlugin> = new Map();

  /** Register a validated plugin. */
  register(plugin: LoadedPlugin): void;

  /** Unregister by name. */
  unregister(name: string): void;

  /** Get a plugin by tool name. Returns undefined for built-in tools. */
  get(name: string): LoadedPlugin | undefined;

  /** Get all loaded plugins. */
  all(): LoadedPlugin[];

  /** Generate OpenAI-compatible tool schemas for all plugins. */
  toToolSchemas(): ToolSchema[];

  /** Reload all plugins from disk. */
  async reload(): Promise<LoadResult>;
}

export interface LoadedPlugin {
  definition: PluginToolDefinition;
  source: 'workspace' | 'global';
  filePath: string;
  loadedAt: number; // Date.now()
}

export interface LoadResult {
  loaded: string[];
  skipped: Array<{ file: string; reason: string }>;
}
```

#### 3.4.4 Tool Schema Injection

The `toolSchemas` array in `src/agent/tools.ts` is currently a static export. In v2.0, it becomes a function:

```typescript
// src/agent/tools.ts (v2.0)

import { getPluginRegistry } from '../plugins/registry.js';

export function getToolSchemas(): ToolSchema[] {
  return [
    ...BUILTIN_TOOL_SCHEMAS,  // execute_bash, manage_file (unchanged)
    ...getPluginRegistry().toToolSchemas()
  ];
}
```

The `AgentLoop` calls `getToolSchemas()` at the start of each turn (not once at construction), so hot-reloaded plugins are immediately available.

### 3.5 Plugin Dispatch (`src/tools/registry.ts` modifications)

The existing `dispatchToolCall()` function gains a plugin fallback path:

```typescript
// src/tools/registry.ts (v2.0 — modified)

export async function dispatchToolCall(name: string, args: any): Promise<ToolDispatchResult> {
  try {
    const session = getRuntimeSession();

    // --- Built-in tools (unchanged) ---
    if (session.dryRun && (name === 'execute_bash' || name === 'manage_file')) {
      return await dispatchDryRunToolCall(name as PlannedToolName, args);
    }
    if (name === 'execute_bash') { /* ... existing logic unchanged ... */ }
    if (name === 'manage_file') { /* ... existing logic unchanged ... */ }

    // --- Plugin dispatch (new) ---
    const plugin = getPluginRegistry().get(name);
    if (plugin) {
      return await dispatchPluginToolCall(plugin, args);
    }

    return {
      content: JSON.stringify({ error: `Tool "${name}" is not implemented.` }),
      haltTurn: false
    };
  } catch (error: any) {
    return { content: JSON.stringify({ error: error.message }), haltTurn: true };
  }
}
```

#### 3.5.1 Plugin Dispatch Flow (`dispatchPluginToolCall`)

```typescript
async function dispatchPluginToolCall(
  plugin: LoadedPlugin,
  args: Record<string, unknown>
): Promise<ToolDispatchResult> {
  const { definition } = plugin;
  const session = getRuntimeSession();

  // Step 1: Optional pre-validation
  if (definition.validate) {
    try {
      await definition.validate(args);
    } catch (err: any) {
      return {
        content: JSON.stringify({ error: `Validation failed: ${err.message}` }),
        haltTurn: false
      };
    }
  }

  // Step 2: MITL gate (risk-dependent)
  if (definition.risk !== 'read') {
    const displayPayload = definition.formatApprovalCard
      ? definition.formatApprovalCard(args)
      : JSON.stringify(args, null, 2);

    const context = definition.risk === 'system' ? 'PLUGIN SYSTEM' : 'PLUGIN';
    const warnings = definition.risk === 'system'
      ? ['This plugin performs system-level operations.']
      : [];

    const mitlResult = await interceptToolCall(
      context as any,
      displayPayload,
      warnings
    );

    if (!mitlResult.approved) {
      return {
        content: JSON.stringify({ error: mitlResult.reason || 'Plugin execution denied.' }),
        haltTurn: !mitlResult.clarifyRequest,
        clarifyRequest: mitlResult.clarifyRequest
      };
    }
  }

  // Step 3: Sandboxed execution
  try {
    const result = await Promise.race([
      definition.execute(args),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Plugin execution timed out (30s).')), 30_000)
      )
    ]);

    // Step 4: Scrub output before returning to LLM context
    const serialized = JSON.stringify(result.output);
    const scrubbed = scrubText(serialized, session.maskingSession);

    return {
      content: scrubbed,
      haltTurn: result.halt ?? false,
      clarifyRequest: result.clarify
    };
  } catch (err: any) {
    // Plugin crash is sandboxed — does NOT halt the agent turn
    return {
      content: JSON.stringify({
        error: `Plugin "${definition.name}" crashed: ${err.message}`
      }),
      haltTurn: false
    };
  }
}
```

### 3.6 MITL Interceptor Extensions

The `interceptToolCall` context parameter currently accepts `'BASH' | 'FILE CREATE' | 'FILE PATCH'`. Extend the type to:

```typescript
export type InterceptionContext =
  | 'BASH'
  | 'FILE CREATE'
  | 'FILE PATCH'
  | 'PLUGIN'        // Standard write-risk plugin
  | 'PLUGIN SYSTEM'  // System-risk plugin (red banner)
  | 'RECIPE STEP'    // Task recipe step preview
  | 'WATCH ACTION';  // Watch mode proposed action
```

The card renderer applies context-dependent ANSI coloring:

| Context | Header Color | Payload Color |
|---|---|---|
| `BASH` | Yellow | Green |
| `FILE CREATE` / `FILE PATCH` | Yellow | Green |
| `PLUGIN` | Cyan | Green |
| `PLUGIN SYSTEM` | Red | Yellow |
| `RECIPE STEP` | Magenta | Green |
| `WATCH ACTION` | Blue | Green |

### 3.7 REPL Commands

| Command | Action |
|---|---|
| `/plugins` | List all loaded plugins with source, risk level, and load time |
| `/plugins reload` | Hot-reload all plugins from disk |
| `/plugins info <name>` | Show full schema and description for a specific plugin |

### 3.8 Dry-Run Integration

Plugins participate in the dry-run system. When `session.dryRun === true`, plugin calls are queued in the `PlanQueue` with a new `PlannedToolName` union:

```typescript
// src/planning/plan-queue.ts (v2.0)
export type PlannedToolName = 'execute_bash' | 'manage_file' | string; // plugin names
```

Read-risk plugins execute immediately during dry-run (same as `manage_file` read). Write and system plugins are queued.

### 3.9 Example Plugin: `read_url`

```typescript
// .getit/tools/read-url.ts
import type { PluginToolDefinition } from 'getit/plugins';

const tool: PluginToolDefinition = {
  name: 'read_url',
  description: 'Fetch a URL and return its text content. Useful for reading documentation, API responses, or web pages.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch.'
      },
      max_length: {
        type: 'number',
        description: 'Maximum response length in characters. Default: 10000.',
        default: 10000
      }
    },
    required: ['url']
  },
  risk: 'read',
  execute: async (args) => {
    const url = args.url as string;
    const maxLength = (args.max_length as number) ?? 10000;

    const response = await fetch(url, {
      headers: { 'User-Agent': 'getit-agent/2.0' },
      signal: AbortSignal.timeout(10_000)
    });

    if (!response.ok) {
      return { output: { error: `HTTP ${response.status}: ${response.statusText}` } };
    }

    const text = await response.text();
    return {
      output: {
        status: response.status,
        content_type: response.headers.get('content-type'),
        body: text.slice(0, maxLength),
        truncated: text.length > maxLength
      }
    };
  }
};

export default tool;
```

### 3.10 Strict Acceptance Criteria

| ID | Criterion |
|---|---|
| **PLG_001** | A valid `.ts` file in `.getit/tools/` is automatically loaded on startup and its tool schema appears in the LLM's available tools. |
| **PLG_002** | A plugin with `risk: 'write'` triggers the standard MITL `[Y/n/e/c]` gate before execution. |
| **PLG_003** | A plugin with `risk: 'read'` executes without MITL prompt. Its output is scrubbed via `scrubText()` before entering LLM context. |
| **PLG_004** | A plugin that throws an exception during `execute()` does NOT halt the agent turn. The error is serialized and returned as tool content. |
| **PLG_005** | A plugin execution exceeding 30 seconds is terminated with a timeout error. |
| **PLG_006** | A plugin with a name collision against a built-in tool (`execute_bash`, `manage_file`) is rejected at load time with a stderr warning. |
| **PLG_007** | `/plugins reload` hot-reloads all plugins without restarting the REPL session. |
| **PLG_008** | Workspace plugins (`.getit/tools/`) take precedence over global plugins (`~/.config/getit/tools/`) with the same name. |
| **PLG_009** | Plugin output containing high-entropy secrets is redacted before reaching the LLM context. |
| **PLG_010** | The `--dry-run` flag queues write/system plugin calls in the PlanQueue and executes read plugins immediately. |

---

## 4. Module B — Persistent Session Memory

### 4.1 Context & Rationale

v1.5's `AgentLoop` maintains a 25-message sliding window (`pruneHistory()`). When a REPL session ends, all context is lost. The next session starts from zero — the agent re-discovers the environment, re-reads project files, and makes proposals that contradict prior user decisions.

Module B introduces a **three-layer local memory system** that persists across sessions while maintaining the zero-dependency and secrets-safe constraints.

### 4.2 Memory Architecture

```
~/.local/state/getit/memory/
├── sessions/
│   ├── 2026-05-24T20-15-00Z.json    # Compressed session summary
│   ├── 2026-05-23T14-30-00Z.json
│   └── ...
├── projects/
│   └── <workspace-hash>.json         # Per-workspace project fingerprint
└── preferences/
    └── global.json                    # Learned approval/denial patterns
```

### 4.3 Layer 1 — Session Summaries (`src/memory/sessions.ts`)

#### 4.3.1 End-of-Session Compression

When the REPL exits cleanly (via `exit`, `Ctrl+C`, or `Ctrl+D`), the memory system compresses the conversation history into a structured summary:

```typescript
export interface SessionSummary {
  /** ISO 8601 timestamp of session start. */
  startedAt: string;
  /** ISO 8601 timestamp of session end. */
  endedAt: string;
  /** Workspace root path active during session (if any). */
  workspaceRoot: string | null;
  /** Total number of user turns. */
  turnCount: number;
  /** Total number of tool calls executed. */
  toolCallCount: number;
  /** Natural language summary of what was accomplished. 3–5 sentences max. */
  summary: string;
  /** List of files created or modified during this session. */
  filesModified: string[];
  /** List of packages installed during this session. */
  packagesInstalled: string[];
  /** Commands that were denied by the user (for preference learning). */
  deniedActions: Array<{
    tool: string;
    args: Record<string, unknown>;
    reason: string;
  }>;
  /** Key decisions or preferences expressed by the user. */
  userDecisions: string[];
}
```

#### 4.3.2 Summary Generation Strategy

The summary is generated **locally without an LLM call** to avoid API costs and ensure offline capability. The strategy:

1. **Scan the message history** for tool calls and their results.
2. **Extract file paths** from `manage_file` calls (action: create/patch).
3. **Extract package names** from `execute_bash` calls matching install patterns (`apt-get install`, `npm install`, `pip install`, `brew install`, etc.).
4. **Extract denied actions** from tool results containing `"denied by user"`.
5. **Compose the summary** from a template: `"Session on {date} in {workspace}. Performed {n} actions: {action_list}. Modified {files}. Installed {packages}."`.

If an LLM carrier is available and the user has opted in via `.getitrc` (`GETIT_SUMMARIZE_WITH_LLM=true`), the summary can optionally be generated via a single LLM call with the conversation history. The LLM-generated summary replaces only the `summary` field — all other fields are still extracted deterministically.

#### 4.3.3 Scrubbing

Before writing to disk, the entire `SessionSummary` object is serialized to JSON, passed through `scrubText()`, and then re-parsed. Any field containing redacted content is stored with redaction markers intact — no attempt is made to reconstruct secrets from redacted summaries.

#### 4.3.4 Retention

- Maximum 50 session summaries retained.
- When the limit is exceeded, the oldest summaries are deleted.
- Summaries are never modified after creation.

#### 4.3.5 Injection into System Prompt

On session startup, `buildSystemPrompt()` is extended to append the most recent 3 session summaries:

```typescript
// src/agent/prompt.ts (v2.0 — addition)

function buildMemoryContext(): string {
  const summaries = loadRecentSessions(3);
  if (summaries.length === 0) return '';

  const lines = ['## Recent Session History'];
  for (const s of summaries) {
    lines.push(`### Session: ${s.startedAt}`);
    lines.push(s.summary);
    if (s.filesModified.length > 0) {
      lines.push(`Files modified: ${s.filesModified.join(', ')}`);
    }
    if (s.deniedActions.length > 0) {
      lines.push(`User denied: ${s.deniedActions.map(d => `${d.tool}(${JSON.stringify(d.args)})`).join(', ')}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
```

### 4.4 Layer 2 — Project Context Graph (`src/memory/projects.ts`)

#### 4.4.1 Project Fingerprint

When a workspace is active (`.getit-manifest.json` exists), the memory system builds a structured project fingerprint by scanning for ecosystem markers:

```typescript
export interface ProjectContext {
  /** SHA-256 of workspace root path (used as filename). */
  workspaceHash: string;
  /** Absolute workspace root path. */
  workspaceRoot: string;
  /** Last scan timestamp. */
  lastScanned: string;
  /** Detected project type(s). */
  projectTypes: ProjectType[];
  /** Detected runtime versions. */
  runtimes: RuntimeInfo[];
  /** Detected package manager. */
  packageManager: string | null;
  /** Dependencies extracted from lock/manifest files. */
  dependencies: DependencyInfo[];
  /** Scripts/tasks defined in project config. */
  scripts: Record<string, string>;
  /** Detected frameworks. */
  frameworks: string[];
  /** Custom notes added by the user via /context command. */
  userNotes: string[];
}

export type ProjectType =
  | 'node' | 'typescript' | 'python' | 'rust' | 'go'
  | 'java' | 'ruby' | 'php' | 'dotnet' | 'c_cpp' | 'unknown';

export interface RuntimeInfo {
  name: string;      // e.g., 'node', 'python', 'rustc'
  version: string;   // e.g., '20.11.0'
  source: string;    // e.g., '.nvmrc', 'package.json engines', 'runtime detection'
}

export interface DependencyInfo {
  name: string;
  version: string;
  dev: boolean;
}
```

#### 4.4.2 Detection Rules

The scanner runs **at workspace initialization** (`manifest init`) and **on demand** (`/context refresh`). It does not run on every session start (to avoid startup latency).

| Marker File | Detected Type | Extracted Data |
|---|---|---|
| `package.json` | `node` / `typescript` (if `typescript` in deps) | `scripts`, `dependencies`, `devDependencies`, `engines.node` |
| `tsconfig.json` | `typescript` | `compilerOptions.target`, `compilerOptions.module` |
| `pyproject.toml` | `python` | `project.dependencies`, `tool.poetry.dependencies` |
| `requirements.txt` | `python` | Package names and version constraints |
| `Cargo.toml` | `rust` | `[dependencies]`, `edition` |
| `go.mod` | `go` | `go` version, `require` list |
| `pom.xml` | `java` | `groupId`, `artifactId`, framework dependencies |
| `Gemfile` | `ruby` | Gem names |
| `composer.json` | `php` | `require` list |
| `.nvmrc` / `.node-version` | `node` | Pinned Node version |
| `docker-compose.yml` | *(adds context)* | Service names, images |
| `Dockerfile` | *(adds context)* | Base image, exposed ports |
| `.env.example` | *(adds context)* | Required environment variable names (no values) |

#### 4.4.3 Injection into System Prompt

```typescript
function buildProjectContext(): string {
  const ctx = loadProjectContext(workspaceRoot);
  if (!ctx) return '';

  const lines = ['## Project Context'];
  lines.push(`Type: ${ctx.projectTypes.join(', ')}`);
  if (ctx.packageManager) lines.push(`Package Manager: ${ctx.packageManager}`);
  for (const rt of ctx.runtimes) {
    lines.push(`Runtime: ${rt.name} ${rt.version} (from ${rt.source})`);
  }
  if (ctx.frameworks.length > 0) {
    lines.push(`Frameworks: ${ctx.frameworks.join(', ')}`);
  }
  if (Object.keys(ctx.scripts).length > 0) {
    lines.push(`Available Scripts: ${Object.keys(ctx.scripts).join(', ')}`);
  }
  if (ctx.userNotes.length > 0) {
    lines.push(`Notes: ${ctx.userNotes.join('; ')}`);
  }
  return lines.join('\n');
}
```

### 4.5 Layer 3 — Preference Learning (`src/memory/preferences.ts`)

#### 4.5.1 Approval Pattern Tracking

Every MITL decision is logged to the preference store:

```typescript
export interface PreferenceStore {
  /** Patterns that the user consistently approves. */
  trustedPatterns: TrustPattern[];
  /** Patterns that the user consistently denies. */
  deniedPatterns: DenyPattern[];
  /** Explicit user-stated preferences from /prefer commands. */
  explicitPreferences: string[];
  /** Last updated timestamp. */
  lastUpdated: string;
}

export interface TrustPattern {
  /** The tool name. */
  tool: string;
  /** A regex pattern matching the approved argument shape. */
  argPattern: string;
  /** Number of consecutive approvals. */
  approvalCount: number;
  /** Threshold required before this pattern influences the prompt. Default: 5. */
  threshold: number;
}

export interface DenyPattern {
  tool: string;
  argPattern: string;
  denialCount: number;
  /** The user's stated reason (from MITL 'n' response). */
  reason: string;
}
```

#### 4.5.2 How Preferences Influence Behavior

Preferences do **NOT** auto-approve actions. They influence the system prompt:

```
## User Preferences (learned from past sessions)
- User prefers `pnpm` over `npm` for package management (approved pnpm 12 times, denied npm install 3 times).
- User denies `sudo` commands (denied 5 times, reason: "use rootless installs").
- User prefers TypeScript strict mode (approved strict tsconfig patches 8 times).
```

The MITL gate remains inviolable. Preferences make the agent's *proposals* smarter, not the *approvals* automatic.

#### 4.5.3 Explicit Preferences

Users can directly state preferences:

| REPL Command | Effect |
|---|---|
| `/prefer pnpm over npm` | Adds `"Use pnpm instead of npm for Node.js package management"` to `explicitPreferences` |
| `/prefer no sudo` | Adds `"Never propose sudo commands; use user-space alternatives"` to `explicitPreferences` |
| `/prefer list` | Lists all learned and explicit preferences |
| `/prefer clear` | Resets all learned patterns (keeps explicit) |
| `/prefer reset` | Resets everything |

### 4.6 REPL Commands

| Command | Action |
|---|---|
| `/memory` | Show memory status: session count, project context loaded, preference count |
| `/memory clear sessions` | Delete all session summaries |
| `/memory clear all` | Delete all memory (sessions + project context + preferences) |
| `/context` | Show current project context |
| `/context refresh` | Re-scan workspace and update project fingerprint |
| `/context note <text>` | Add a user note to the project context |
| `/prefer <statement>` | Add an explicit preference |
| `/prefer list` | List all preferences |

### 4.7 Strict Acceptance Criteria

| ID | Criterion |
|---|---|
| **MEM_001** | On clean REPL exit, a session summary JSON file is written to `~/.local/state/getit/memory/sessions/`. |
| **MEM_002** | Session summaries pass through `scrubText()` before disk write. API keys present in conversation history do not appear in the summary file. |
| **MEM_003** | On session startup, the 3 most recent session summaries are injected into the system prompt. |
| **MEM_004** | `manifest init` triggers project context scanning. The context JSON includes detected project type, package manager, and available scripts. |
| **MEM_005** | Project context is injected into the system prompt when a workspace is active. |
| **MEM_006** | After 5 consecutive MITL approvals of the same tool + argument pattern, the pattern appears in the system prompt as a learned preference. |
| **MEM_007** | Learned preferences never bypass the MITL gate. They only influence the system prompt. |
| **MEM_008** | `/prefer` commands write to `preferences/global.json` and are injected into the next session's system prompt. |
| **MEM_009** | Maximum 50 session summaries are retained. Oldest are deleted when the limit is exceeded. |
| **MEM_010** | Project context scanning completes in < 500ms for a workspace with 10 marker files. |

---

## 5. Module C — Task Recipes

### 5.1 Context & Rationale

getit handles one intent at a time. Real workflows are multi-step and repeatable: "set up a Node project", "deploy to production", "run the test suite and fix failures". Users currently re-type the same sequences or rely on the LLM to remember (which it can't across sessions).

Task Recipes are declarative YAML files that define reusable, composable, multi-step automation workflows. Each step is a natural language intent — not a bash command. The agent adapts each step to the current platform, project state, and user preferences.

### 5.2 Recipe File Format

```yaml
# .getit/recipes/setup-node-project.yaml

name: setup-node-project
version: "1.0"
description: "Initialize a TypeScript Node.js project with best practices."
author: "brian"

# Preconditions checked before execution begins.
conditions:
  requires: [node, npm]            # Binaries that must be present
  min_node_version: "20.0.0"      # Optional version constraint
  workspace: true                  # Must be inside a getit workspace

# Variables that the user can override at runtime.
variables:
  project_name:
    description: "The project name for package.json"
    default: "my-project"
  strict_mode:
    description: "Enable TypeScript strict mode"
    default: true
    type: boolean

# Sequential steps. Each step.intent is natural language.
steps:
  - id: init-package
    intent: "Initialize package.json with name '{{project_name}}', type 'module', and ISC license"
    skip_if: "package.json already exists"

  - id: install-typescript
    intent: "Install typescript and @types/node as dev dependencies"
    depends_on: [init-package]

  - id: create-tsconfig
    intent: "Create tsconfig.json targeting ES2022 with moduleResolution 'node16', outDir 'dist/', rootDir 'src/', and strict mode {{strict_mode}}"
    depends_on: [install-typescript]

  - id: create-src
    intent: "Create src/index.ts with a minimal hello world that logs 'Hello from {{project_name}}'"
    depends_on: [create-tsconfig]

  - id: add-scripts
    intent: "Add 'build': 'tsc', 'start': 'node dist/src/index.js', and 'dev': 'tsc && node dist/src/index.js' scripts to package.json"
    depends_on: [create-src]

  - id: add-gitignore
    intent: "Create .gitignore with node_modules/, dist/, and .env entries"
    skip_if: ".gitignore already exists"

  - id: verify
    intent: "Run 'npm run build' to verify the setup compiles successfully"
    depends_on: [add-scripts, add-gitignore]
    on_failure: continue   # Don't abort the recipe on build failure
```

### 5.3 Recipe Schema (`src/recipes/types.ts`)

```typescript
export interface Recipe {
  name: string;
  version: string;
  description: string;
  author?: string;
  conditions?: RecipeConditions;
  variables?: Record<string, RecipeVariable>;
  steps: RecipeStep[];
}

export interface RecipeConditions {
  requires?: string[];              // Binary names
  min_node_version?: string;
  workspace?: boolean;
  files_exist?: string[];           // Paths that must exist
  files_absent?: string[];          // Paths that must NOT exist
}

export interface RecipeVariable {
  description: string;
  default?: unknown;
  type?: 'string' | 'number' | 'boolean';
  required?: boolean;
}

export interface RecipeStep {
  id: string;
  intent: string;                   // Natural language — sent to LLM
  depends_on?: string[];            // Step IDs that must complete first
  skip_if?: string;                 // Natural language condition — LLM evaluates
  on_failure?: 'abort' | 'continue' | 'retry';  // Default: 'abort'
  max_retries?: number;             // Default: 1 (only if on_failure === 'retry')
  timeout_seconds?: number;         // Per-step timeout. Default: 120.
}
```

### 5.4 Recipe Engine (`src/recipes/engine.ts`)

#### 5.4.1 Execution Flow

```
getit run <recipe-name> [--var key=value ...]
    │
    ▼
┌─────────────────────────────┐
│ 1. Locate recipe file       │  .getit/recipes/ → ~/.config/getit/recipes/
│ 2. Parse YAML (native)      │  Using a minimal YAML parser (see §5.4.2)
│ 3. Validate schema          │
│ 4. Check conditions         │  Binary availability, workspace state
│ 5. Resolve variables        │  CLI overrides → prompted → defaults
└──────────────┬──────────────┘
               ▼
┌─────────────────────────────┐
│ 6. Present execution plan   │  MITL gate: show all steps with
│    (RECIPE STEP context)    │  resolved variables, ask [Y/n]
└──────────────┬──────────────┘
               ▼
┌─────────────────────────────┐
│ 7. Execute steps            │  For each step (respecting depends_on):
│    sequentially             │    a. Evaluate skip_if (if present)
│                             │    b. Inject step.intent into AgentLoop
│                             │    c. Agent proposes tool calls
│                             │    d. Each tool call passes MITL gate
│                             │    e. On failure: abort/continue/retry
└──────────────┬──────────────┘
               ▼
┌─────────────────────────────┐
│ 8. Write execution report   │  Summary of completed/skipped/failed steps
│                             │  Stored in session memory
└─────────────────────────────┘
```

#### 5.4.2 YAML Parsing

To maintain zero dependencies, implement a **minimal YAML subset parser** in `src/recipes/yaml-parser.ts` supporting only:

- Key-value pairs (strings, numbers, booleans)
- Arrays (block style with `-` prefix)
- Nested objects (indentation-based)
- Comments (`#`)
- Quoted strings (single and double)
- Template variables (`{{var}}`)

This covers 100% of the recipe schema. Full YAML spec compliance (anchors, tags, flow style, multi-line scalars) is explicitly out of scope and not needed.

**Implementation requirement:** The parser must be ≤ 300 lines. If it grows beyond that, the recipe format is too complex — simplify the format.

#### 5.4.3 Step Execution

Each step is fed to the `AgentLoop` as a synthetic user turn:

```typescript
async function executeStep(
  loop: AgentLoop,
  step: RecipeStep,
  variables: Record<string, unknown>,
  projectContext: ProjectContext | null
): Promise<StepResult> {
  // Resolve template variables in the intent
  const resolvedIntent = resolveTemplates(step.intent, variables);

  // Build a recipe-aware user prompt
  const prompt = [
    `[Recipe Step: ${step.id}]`,
    resolvedIntent,
    projectContext ? `[Project: ${projectContext.projectTypes.join(', ')}]` : '',
    `[Instruction: Complete this step using the minimum number of tool calls. Do not ask clarifying questions — the intent is fully specified.]`
  ].filter(Boolean).join('\n');

  // Execute as a normal agent turn
  await loop.runTurn(prompt);

  // Analyze the resulting message history for success/failure
  return analyzeStepOutcome(loop.getMessages(), step);
}
```

### 5.5 REPL Commands

| Command | Action |
|---|---|
| `/recipes` or `/recipes list` | List available recipes (workspace + global) |
| `/recipes info <name>` | Show recipe details: steps, conditions, variables |
| `/recipes run <name>` | Execute a recipe (alias for `getit run <name>`) |
| `/recipes create` | Interactive recipe builder — records your session as a recipe |

### 5.6 Recipe Recording (Interactive Builder)

A power feature: `/recipes create` enters recording mode. Every user intent and the resulting tool calls are captured. When the user types `/recipes save <name>`, the recorded steps are serialized into a `.getit-task.yaml` file.

```
getit-agent ❯ /recipes create
📝 Recording started. Type your intents normally. Type /recipes save <name> when done.

getit-agent ❯ initialize a new npm project
[... normal agent interaction, MITL gates fire ...]

getit-agent ❯ install express and typescript
[... normal agent interaction ...]

getit-agent ❯ /recipes save setup-express
📁 Recipe saved to .getit/recipes/setup-express.yaml (2 steps recorded)
```

### 5.7 Strict Acceptance Criteria

| ID | Criterion |
|---|---|
| **RCP_001** | `getit run <recipe>` locates a `.yaml` file in `.getit/recipes/` or `~/.config/getit/recipes/`, parses it, and executes steps sequentially. |
| **RCP_002** | Recipe conditions are validated before execution. Missing binaries abort with a clear error message. |
| **RCP_003** | Template variables (`{{var}}`) are resolved from CLI `--var` flags, then interactive prompts, then defaults. |
| **RCP_004** | Each step's MITL gate fires independently — approving the recipe plan does not auto-approve individual tool calls. |
| **RCP_005** | `skip_if` conditions are evaluated by the LLM. If the condition is met, the step is skipped and logged. |
| **RCP_006** | `on_failure: continue` causes the recipe to proceed to the next step after a failure, with the failure logged. |
| **RCP_007** | The YAML parser handles the full recipe schema in ≤ 300 lines with zero external dependencies. |
| **RCP_008** | `/recipes create` enters recording mode and `/recipes save` serializes the recorded session into a valid recipe file. |

---

## 6. Module D — Watch Mode

### 6.1 Context & Rationale

getit currently waits for the user to type. For a workspace manager, proactive monitoring is essential: build errors should be caught immediately, drift should be flagged, and secrets should be blocked before they reach a remote repository.

### 6.2 Architecture

```
getit watch [--build] [--drift] [--hooks]
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│                   WatchDaemon (single Node thread)       │
│                                                          │
│  ┌───────────────┐  ┌───────────────┐  ┌──────────────┐ │
│  │ BuildWatcher   │  │ DriftSentinel │  │ HookManager  │ │
│  │ (fs.watch src/)│  │ (fs.watch     │  │ (.git/hooks/ │ │
│  │               │  │  tracked files)│  │  integration)│ │
│  └───────┬───────┘  └───────┬───────┘  └──────┬───────┘ │
│          ▼                  ▼                  ▼         │
│  ┌──────────────────────────────────────────────────────┐│
│  │          NotificationQueue (debounced, batched)       ││
│  └──────────────────────────┬───────────────────────────┘│
│                             ▼                            │
│  ┌──────────────────────────────────────────────────────┐│
│  │          MITL Gate (WATCH ACTION context)             ││
│  └──────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

### 6.3 Build Watcher (`src/watcher/build.ts`)

#### 6.3.1 Behavior

- Uses `fs.watch(src/, { recursive: true })` to monitor source directories.
- On file change, debounces for 500ms to batch rapid edits.
- Executes the project's build command (detected from `package.json` scripts, `Makefile`, `Cargo.toml`, etc.).
- If the build fails, pipes stderr through the existing `attemptDependencyHealing()` healer.
- If the healer proposes a fix, queues it for MITL approval.

#### 6.3.2 Configuration

```ini
# .getitrc (watch mode config)
GETIT_WATCH_BUILD_CMD=npm run build     # Override auto-detected build command
GETIT_WATCH_DEBOUNCE_MS=500             # Debounce interval
GETIT_WATCH_IGNORE=node_modules,dist,.git  # Directories to exclude
```

### 6.4 Drift Sentinel (`src/watcher/drift.ts`)

#### 6.4.1 Behavior

- Monitors all tracked files (from the workspace manifest).
- When a tracked file changes outside of getit (i.e., the user edits it manually), it:
  1. Computes the new scrubbed hash.
  2. Compares against the manifest hash.
  3. If drift is detected, logs a notification: `"⚠ Drift detected: .bashrc modified outside getit"`.
  4. Offers to snapshot the new state: `"Snapshot the current state? [Y/n]"`.

### 6.5 Git Hook Manager (`src/watcher/hooks.ts`)

#### 6.5.1 Installation

```bash
getit hooks install    # Installs pre-commit and pre-push hooks
getit hooks remove     # Removes getit hooks
getit hooks status     # Shows which hooks are installed
```

#### 6.5.2 Pre-Commit Hook

- Runs the scrubber (`scrubText()`) against all staged file contents.
- If any file contains unscrubbed secrets (scrubbed content differs from original), the commit is blocked with a detailed report showing which file and which line contains the suspected secret.

#### 6.5.3 Pre-Push Hook

- Extends the existing `src/workspace/remote.ts` pre-push validation.
- Scans the outgoing diff for high-entropy strings and known secret patterns.
- If detected, aborts the push and prints a red warning with file paths and line numbers.

#### 6.5.4 Hook Script Template

Hooks are shell scripts that invoke getit:

```bash
#!/bin/sh
# .git/hooks/pre-commit (installed by getit)
exec getit hook pre-commit "$@"
```

The actual logic lives in `src/watcher/hooks.ts` and is invoked via a new CLI subcommand `getit hook <type>`.

### 6.6 Notification Queue (`src/watcher/notifications.ts`)

All watcher events flow through a central queue:

```typescript
export interface WatchNotification {
  source: 'build' | 'drift' | 'hook';
  severity: 'info' | 'warning' | 'error';
  message: string;
  timestamp: number;
  /** Optional proposed fix (routed to MITL gate). */
  proposedAction?: {
    description: string;
    tool: string;
    args: Record<string, unknown>;
  };
}
```

In watch mode, notifications are rendered as persistent terminal alerts above the prompt line. In REPL mode (if watch is running in background), they appear as inline messages between agent turns.

### 6.7 REPL Commands

| Command | Action |
|---|---|
| `/watch start [--build] [--drift]` | Start watchers in background |
| `/watch stop` | Stop all watchers |
| `/watch status` | Show active watchers and queued notifications |
| `/hooks install` | Install git hooks |
| `/hooks remove` | Remove git hooks |

### 6.8 Strict Acceptance Criteria

| ID | Criterion |
|---|---|
| **WCH_001** | `getit watch --build` detects file changes in `src/` and triggers the build command within 1 second (after debounce). |
| **WCH_002** | A failed build routes stderr through `attemptDependencyHealing()`. If matched, the fix is presented via the WATCH ACTION MITL gate. |
| **WCH_003** | `getit watch --drift` detects manual modifications to tracked files and logs a notification. |
| **WCH_004** | `getit hooks install` writes executable pre-commit and pre-push scripts to `.git/hooks/`. |
| **WCH_005** | The pre-commit hook blocks a commit containing a file with an unscrubbed API key. |
| **WCH_006** | The pre-push hook blocks a push when the outgoing diff contains high-entropy secrets. |
| **WCH_007** | All watch mode features use `node:fs` native `watch` API. Zero external dependencies. |
| **WCH_008** | Watch mode runs on a single Node thread with no additional process spawning for the watcher itself. |

---

## 7. Module E — Rich Terminal Dashboard

### 7.1 Context & Rationale

v1.5 renders MITL cards and agent output as linear scrollback. For an active workspace manager — especially with watch mode, plugins, and memory — the user needs persistent state visibility without scrolling.

### 7.2 Layout

```
┌─── getit v2.0 ─────────────────────────────────────────────────────────┐
│ ⚡ node:20.11  │  📦 pnpm  │  🔒 normal  │  🧠 3 sessions  │  🔌 4 plugins │
├─────────────────────────────────────────────────────────────────────────┤
│                                     │ 📋 Ledger                        │
│  Agent conversation                 │ ✅ 14:01 installed ripgrep       │
│  flows here in the                  │ ✅ 14:02 patched .bashrc         │
│  main pane...                       │ ⏳ 14:03 pending: tsconfig       │
│                                     │ ❌ 14:05 denied: sudo apt-get   │
│                                     │                                  │
│                                     │ 📡 Watchers                      │
│                                     │ 🟢 build: watching src/          │
│                                     │ 🟢 drift: 14 files tracked       │
│                                     │                                  │
├─────────────────────────────────────┴──────────────────────────────────┤
│ [workspace: ~/projects/getit]  14 tracked │ 2 drifted │ 0 missing     │
├─────────────────────────────────────────────────────────────────────────┤
│ getit-agent ❯ _                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

### 7.3 Implementation Strategy

Built entirely with ANSI escape sequences and Node's `process.stdout.write()` — the same approach the current MITL cards use, extended to manage screen regions.

```typescript
// src/ui/dashboard.ts

export class Dashboard {
  private headerHeight: number = 2;
  private sidebarWidth: number = 36;
  private footerHeight: number = 2;
  private enabled: boolean;

  constructor() {
    // Dashboard is enabled only if:
    // 1. stdout is a TTY (not piped)
    // 2. Terminal width ≥ 100 columns
    // 3. Terminal height ≥ 24 rows
    // 4. User hasn't set GETIT_SIMPLE_UI=true
    this.enabled = process.stdout.isTTY
      && (process.stdout.columns ?? 80) >= 100
      && (process.stdout.rows ?? 24) >= 24
      && process.env.GETIT_SIMPLE_UI !== 'true';
  }

  /** Render the full dashboard frame. Called once on startup. */
  renderFrame(): void;

  /** Update the header bar (carrier, profile, stats). */
  updateHeader(stats: HeaderStats): void;

  /** Append a line to the main conversation pane (scrollable). */
  appendMainPane(line: string): void;

  /** Update the sidebar ledger with recent actions. */
  updateLedger(entries: LedgerEntry[]): void;

  /** Update the footer status bar. */
  updateFooter(status: FooterStatus): void;

  /** Temporarily take over the full screen (for MITL cards). */
  enterFullscreen(): void;

  /** Restore the dashboard layout after fullscreen. */
  exitFullscreen(): void;

  /** Graceful degradation: if disabled, these are all no-ops and output
   *  flows to stdout normally (v1.5 behavior). */
}
```

### 7.4 Graceful Degradation

If the terminal is too small, stdout is piped, or `GETIT_SIMPLE_UI=true`, the dashboard disables itself entirely. All output falls through to the v1.5 linear scrollback behavior. The dashboard is purely additive — removing it changes no functionality.

### 7.5 REPL Commands

| Command | Action |
|---|---|
| `/ui dashboard` | Enable dashboard mode |
| `/ui simple` | Disable dashboard, use linear scrollback |
| `/ui toggle` | Switch between modes |

### 7.6 Strict Acceptance Criteria

| ID | Criterion |
|---|---|
| **TUI_001** | Dashboard renders correctly on terminals ≥ 100×24 characters. |
| **TUI_002** | Dashboard automatically disables on terminals < 100×24, piped stdout, or `GETIT_SIMPLE_UI=true`. |
| **TUI_003** | MITL approval cards temporarily take over the screen and restore the dashboard afterward. |
| **TUI_004** | The main conversation pane scrolls correctly when output exceeds the pane height. |
| **TUI_005** | The sidebar updates in real-time with watcher notifications and ledger entries. |
| **TUI_006** | Zero external dependencies. All rendering uses `process.stdout.write` with ANSI escape sequences. |
| **TUI_007** | `Ctrl+C` and `exit` cleanly restore the terminal to its pre-dashboard state (alternate screen buffer cleanup). |

---

## 8. Module F — Multi-Machine Sync

### 8.1 Context & Rationale

Phase 3 built the scrubbed tracking repository and GitHub sync skeleton (`src/workspace/remote.ts`). Module F completes the vision: getit becomes a full dotfile manager with encrypted secret handling and multi-machine profile support.

### 8.2 Encrypted Secrets Vault (`src/vault/vault.ts`)

#### 8.2.1 Design

Secrets are stored in a local encrypted vault at `~/.local/state/getit/vault.enc`. The vault is a single file containing AES-256-GCM encrypted JSON:

```typescript
export interface VaultEntry {
  /** The file path this secret belongs to. */
  filePath: string;
  /** The placeholder token used in the scrubbed version (e.g., [REDACTED_1]). */
  placeholder: string;
  /** The original secret value (only exists in decrypted form in memory). */
  value: string;
}

export interface VaultData {
  version: 1;
  entries: VaultEntry[];
  createdAt: string;
  lastModified: string;
}
```

#### 8.2.2 Encryption

```typescript
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;

export function encryptVault(data: VaultData, passphrase: string): Buffer {
  const salt = randomBytes(SALT_LENGTH);
  const key = scryptSync(passphrase, salt, KEY_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const plaintext = JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // File format: [salt:32][iv:16][tag:16][ciphertext:*]
  return Buffer.concat([salt, iv, tag, encrypted]);
}

export function decryptVault(buffer: Buffer, passphrase: string): VaultData {
  const salt = buffer.subarray(0, SALT_LENGTH);
  const iv = buffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = buffer.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
  const ciphertext = buffer.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

  const key = scryptSync(passphrase, salt, KEY_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString('utf-8'));
}
```

#### 8.2.3 Vault Lifecycle

1. **First use:** `getit vault init` prompts for a passphrase. Stores nothing about the passphrase itself — authentication is verified by successful GCM decryption (tag validation).
2. **Session unlock:** On session start, if the vault exists, the user is prompted for the passphrase. The decrypted vault is held in memory for the session duration.
3. **Adding secrets:** When the scrubber redacts a value during `manage_file` create/patch, the user is prompted: `"Store this secret in the vault for future sync? [Y/n]"`. If yes, a `VaultEntry` is added.
4. **Sync integration:** During `getit sync pull`, after the scrubbed tracking files are applied, vault entries matching the target files have their placeholders replaced with real values. The live file contains secrets; the tracking mirror remains scrubbed.

### 8.3 Profile-Based Sync (`src/sync/profiles.ts`)

#### 8.3.1 Profile Structure

The existing `profiles/<fingerprint>/` system from v1.5 is extended:

```
~/.local/state/getit/tracking/
├── common/                    # Shared across all machines
│   ├── .bashrc
│   ├── .gitconfig
│   └── .config/getit/policy.json
├── profiles/
│   ├── <fingerprint-A>/      # Machine-specific overrides
│   │   ├── .bashrc.local     # Sourced by common .bashrc
│   │   └── .npmrc
│   └── <fingerprint-B>/
│       ├── .bashrc.local
│       └── .npmrc
└── .getit-sync-manifest.json  # Sync state: last push/pull timestamps, remote SHA
```

#### 8.3.2 Sync Commands

| Command | Action |
|---|---|
| `getit sync status` | Show local vs. remote divergence |
| `getit sync push` | Push scrubbed tracking repo to remote. Pre-push secret scan runs first. |
| `getit sync pull` | Pull from remote. Apply common + profile-specific files. Vault-inject secrets. |
| `getit sync resolve` | Interactive 3-way merge for conflicting files. |

### 8.4 Three-Way Merge (`src/sync/merge.ts`)

When the same file is modified on two machines:

1. **Base:** The common ancestor from the last sync point.
2. **Local:** The current machine's version.
3. **Remote:** The other machine's version.

The merge engine generates a unified diff showing all three versions, presented in the MITL gate:

```
╔══════════════════════════════════════════════════════════╗
║  SYNC CONFLICT: .bashrc                                  ║
╠══════════════════════════════════════════════════════════╣
║  BASE (last sync):                                       ║
║    export PATH="$HOME/.cargo/bin:$PATH"                  ║
║                                                          ║
║  LOCAL (this machine):                                   ║
║    export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH" ║
║                                                          ║
║  REMOTE (other machine):                                 ║
║    export PATH="$HOME/.cargo/bin:$HOME/go/bin:$PATH"     ║
╠══════════════════════════════════════════════════════════╣
║  [l] Keep local  [r] Keep remote  [m] Manual merge       ║
║  [a] Ask AI to merge                                     ║
╚══════════════════════════════════════════════════════════╝
```

The `[a]` option feeds both versions to the LLM with the instruction: "Merge these two configuration fragments. Preserve all unique additions from both versions." The LLM's proposed merge is shown in a follow-up MITL card before application.

### 8.5 Strict Acceptance Criteria

| ID | Criterion |
|---|---|
| **SYN_001** | `getit vault init` creates an AES-256-GCM encrypted vault file. Decryption with the correct passphrase succeeds; wrong passphrase fails with authentication error. |
| **SYN_002** | Vault entries are injected into live files during `sync pull`. The tracking mirror retains `[REDACTED_N]` placeholders. |
| **SYN_003** | `sync push` runs the pre-push secret scan. If unscrubbed secrets are detected, the push is aborted. |
| **SYN_004** | `sync pull` applies common files first, then profile-specific overrides. |
| **SYN_005** | Conflicting files trigger the 3-way merge interface with `[l/r/m/a]` options. |
| **SYN_006** | The `[a]` AI merge option sends both versions to the LLM and presents the result in a MITL card before application. |
| **SYN_007** | All vault operations use Node's native `node:crypto` module. Zero external dependencies. |
| **SYN_008** | `sync status` works offline (shows local state) when the remote is unreachable. |

---

## 8b. Module G — Custom Themable UI Shell (TerminalKit)

### 8b.1 Context & Rationale

v1.5 ships a competent but utilitarian terminal experience: ANSI colors, spinners, banners, and the `formatLeftJustified()` helper. v2.0 introduces **TerminalKit** — a zero-dependency, themable UI shell that gives getit a distinctive, attractive visual identity while remaining accessible on dumb terminals and CI runners.

TerminalKit is the *substrate* that Module E (the Rich TUI dashboard) and Module H (Control Plane & UX) render against. Rather than scattering ANSI escape sequences across the codebase, every drawing operation routes through a small set of primitives — `Box`, `Pane`, `Text`, `List`, `Progress`, `Sparkline`, `Toast`, `Modal`, `Prompt`, `Palette`, `Spinner` — that respect the active *theme*, the active *glyph set*, and the active *accessibility profile*.

Design tenets:

1. **Zero dependencies.** No `blessed`, no `ink`, no `chalk`. All ANSI is hand-rolled in `src/ui/terminalkit/ansi.ts`.
2. **Theme as data.** Themes are JSON. Users author them in `.getit/themes/<name>.json`. Six themes ship built-in.
3. **Degradation is first-class.** Every primitive answers `render(capabilities)` where `capabilities` is detected once at startup (`detectCapabilities()`).
4. **Stable layout under resize.** All panes subscribe to a single `ResizeBus`; redraw is double-buffered with a diff renderer so flicker is eliminated.
5. **Composable, not magical.** TerminalKit primitives are plain classes returning strings or applying writes against a `Surface`. There is no virtual DOM and no reconciler.

### 8b.2 Capability Detection (`src/ui/terminalkit/capabilities.ts`)

```typescript
export interface TerminalCapabilities {
  /** stdout is a TTY (interactive). */
  isTTY: boolean;
  /** Width in columns (clamped to [40, 400]). */
  columns: number;
  /** Height in rows (clamped to [10, 200]). */
  rows: number;
  /** Color depth: 'none' | '16' | '256' | 'truecolor'. */
  colorDepth: 'none' | '16' | '256' | 'truecolor';
  /** Whether the terminal advertises Unicode (LANG/LC_ALL contains UTF-8). */
  unicode: boolean;
  /** Whether the terminal supports the Kitty graphics or Sixel protocol. */
  graphics: 'none' | 'kitty' | 'sixel';
  /** Whether the terminal supports OSC-8 hyperlinks (iTerm2, WezTerm, kitty). */
  hyperlinks: boolean;
  /** Whether the terminal reports as Apple Terminal, iTerm2, Windows Terminal, etc. */
  emulator: string;
  /** Forced simple mode (set by GETIT_SIMPLE_UI=true or non-TTY). */
  simple: boolean;
  /** Accessibility profile (env GETIT_A11Y=high-contrast|screen-reader|none). */
  a11y: 'none' | 'high-contrast' | 'screen-reader';
}

export function detectCapabilities(): TerminalCapabilities;
```

Detection rules:

- `colorDepth` derives from `COLORTERM=truecolor`, `TERM=*-256color`, `TERM=xterm`/`screen`/`vt100`, and `NO_COLOR` (forces `'none'`).
- `unicode` is `true` unless `LANG`/`LC_ALL`/`LC_CTYPE` lacks `utf` (case-insensitive) and `TERM_PROGRAM` is not in a known UTF-8 set.
- `graphics` probes `KITTY_WINDOW_ID` and `TERM_PROGRAM=WezTerm`/`iTerm.app`.
- `simple` is forced if `GETIT_SIMPLE_UI=true`, `CI=true`, or stdout is not a TTY.
- `a11y='screen-reader'` disables all spinners, progress bars, and animations; all output becomes line-oriented with explicit prefixes (`[status]`, `[error]`, etc.).

### 8b.3 Theme Schema (`src/ui/terminalkit/themes/types.ts`)

```typescript
export interface Theme {
  name: string;
  author?: string;
  version?: string;
  palette: {
    bg:        string;  // primary background
    bgAlt:     string;  // alternate row background (lists)
    fg:        string;  // primary foreground
    fgDim:     string;  // secondary text (help, hints)
    fgMuted:   string;  // tertiary text (timestamps)
    accent:    string;  // brand accent (logo, active border)
    accent2:   string;  // secondary accent (selections)
    success:   string;
    warning:   string;
    danger:    string;
    info:      string;
    border:    string;
    borderHot: string;
    selection: string;
  };
  borders: 'rounded' | 'sharp' | 'double' | 'ascii';
  glyphs: 'unicode' | 'nerdfont' | 'ascii';
  italics: boolean;
  spinner: 'dots' | 'pulse' | 'arc' | 'wave' | 'ascii-bar';
  animationMs: number;
}
```

#### Built-in themes (shipped in `src/ui/terminalkit/themes/builtin/`)

| Theme | Mood | Default For |
|---|---|---|
| `eclipse` | Cool, deep blue + cyan accent, rounded borders | `truecolor` + `unicode` |
| `solar` | Warm amber + papyrow, sharp borders | High-contrast warm setups |
| `mono` | Pure greyscale, ASCII borders | `colorDepth=none`, accessibility |
| `forge` | Industrial slate + ember orange | Default on Windows Terminal |
| `meadow` | Botanic greens, double borders | `light` preference |
| `vapor` | Synthwave magenta/cyan gradients | Demo mode |

Theme files load via `loadTheme(name)` from `.getit/themes/<name>.json` first, then bundled fallback. Invalid themes log a warning and the loader keeps the previous theme.

### 8b.4 Glyph Sets (`src/ui/terminalkit/glyphs.ts`)

```typescript
export interface GlyphSet {
  box: { tl: string; tr: string; bl: string; br: string; h: string; v: string;
         tDown: string; tUp: string; tLeft: string; tRight: string; cross: string };
  status: { ok: string; warn: string; err: string; info: string; pending: string };
  bullets: string[];
  brand: string;
  progress: string[];        // 8 steps, finest → full
  sparkline: string[];       // 9 levels
  arrows: { up: string; down: string; left: string; right: string;
            collapse: string; expand: string };
}
```

Three glyph sets ship: `unicode` (default UTF-8), `nerdfont` (adds Powerline + dev icons; auto-selected when `terminfo` reports a Nerd Font on Linux/macOS), and `ascii` (pure 7-bit fallback). Theme `glyphs` field overrides auto-selection.

### 8b.5 Primitives (`src/ui/terminalkit/primitives/`)

All primitives implement:

```typescript
export interface Primitive {
  width: number | 'auto';
  height: number | 'auto';
  render(surface: Surface, region: Region, ctx: RenderContext): void;
}
```

| Primitive | File | Purpose |
|---|---|---|
| `Box` | `box.ts` | Bordered container with optional title and subtitle |
| `Pane` | `pane.ts` | Scrollable region with persistent scroll state |
| `Text` | `text.ts` | Wrapped, color-tagged text using `<accent>…</accent>` micro-markup |
| `List` | `list.ts` | Selectable list with keyboard nav, sticky header, fuzzy filter |
| `Progress` | `progress.ts` | Determinate + indeterminate bars; supports stacked sub-bars |
| `Sparkline` | `sparkline.ts` | Inline 8-step sparkline for token rate, latency history |
| `Spinner` | `spinner.ts` | Themed spinner (replaces v1.5 spinner; superset API) |
| `Toast` | `toast.ts` | Non-blocking ephemeral notifications (queued by `NotificationQueue`) |
| `Modal` | `modal.ts` | Center-screen blocking overlay for confirmations |
| `Prompt` | `prompt.ts` | Single-line input with completion, history, masking |
| `Palette` | `palette.ts` | Command palette (used by Module H §8c.3) |
| `Diff` | `diff.ts` | Side-by-side or unified diff renderer with syntax-agnostic gutter |

#### Micro-markup

`Text` accepts inline markup tags that resolve to palette colors:

```
<accent>getit</accent> <fgMuted>v2.0</fgMuted> — <success>ready</success>
```

Tags are parsed by `src/ui/terminalkit/markup.ts` (~80 lines). Unknown tags pass through as literal text. Markup never produces unbalanced ANSI: every `\x1b[...m` open is paired with a `\x1b[0m` close at tag end.

#### Surface and double-buffered rendering

```typescript
// src/ui/terminalkit/surface.ts
export class Surface {
  constructor(cols: number, rows: number);
  put(x: number, y: number, ch: string, style: Style): void;
  fill(region: Region, style: Style, ch?: string): void;
  /** Compute the minimal diff against the last flush and write to stdout. */
  flush(stdout: NodeJS.WriteStream): void;
}
```

`flush()` produces a *diff frame*: for each row, emit `CSI y;1H` followed by only the runs that changed since the last frame. This eliminates flicker even on slow PTYs and is the foundation under Module E.

### 8b.6 Animations & Transitions (`src/ui/terminalkit/animate.ts`)

Animations are pull-based: a `Ticker` calls `frame(t)` on registered animatables at the theme's `animationMs` cadence. There is no `setInterval` running unless at least one animation is registered, and the ticker stops when none remain.

Built-in animations:

| Animation | Use |
|---|---|
| `pulse(color)` | Border highlight when a pane gains focus |
| `streamCaret` | Cyclic caret while LLM tokens stream into a pane |
| `progressShimmer` | Indeterminate progress bar shimmer |
| `toastSlideIn` | One-row vertical slide for toast notifications |
| `paletteFade` | 6-frame fade for palette open/close |

All animations honor `a11y='screen-reader'` (no-op) and `simple=true` (no-op).

### 8b.7 Splash & Identity

On REPL launch, TerminalKit renders a splash:

```
                 ╭──────────────────────────────╮
                 │   ▄████  ▄███▄  ▄████  ████  │
                 │   ██     ██ ██  ██  █    ██  │     getit v2.0
                 │   ██ ██  █████  █████    ██  │     manager-grade CLI
                 │   ▀████  ██ ██  ██  █   ████ │
                 ╰──────────────────────────────╯
   <accent>theme:</accent> eclipse   <accent>carrier:</accent> openrouter   <accent>model:</accent> auto
   <fgMuted>type</fgMuted> /help <fgMuted>or press</fgMuted> Ctrl-K <fgMuted>for the command palette</fgMuted>
```

The brand mark is theme-substitutable. On `simple=true`, the splash collapses to a single line:

```
getit v2.0 — theme=eclipse carrier=openrouter model=auto — /help
```

### 8b.8 REPL Commands

```
/theme list                # List built-in + user themes
/theme set <name>          # Switch theme live (no restart)
/theme preview <name>      # Render a sampler box without committing
/theme export <name>       # Print current theme as JSON
/glyphs set <unicode|nerdfont|ascii>
/ui simple [on|off]        # Toggle simple-mode override
/ui a11y <none|high-contrast|screen-reader>
/ui reload                 # Re-detect capabilities (useful after font swap)
```

### 8b.9 Strict Acceptance Criteria

- **UIK_001** `detectCapabilities()` returns `simple=true` when stdout is not a TTY.
- **UIK_002** All six built-in themes load, validate, and render the splash without ANSI artifacts.
- **UIK_003** Switching theme via `/theme set <name>` repaints the screen within one frame and persists choice to `.getitrc`.
- **UIK_004** Markup parser never produces unbalanced escape sequences (verified by stripping and re-scanning output).
- **UIK_005** Double-buffered `Surface.flush()` writes ≤ 30% of full-screen bytes for incremental updates (measured in `ui-surface.test.ts`).
- **UIK_006** Setting `NO_COLOR=1` strips all ANSI color sequences from rendered output.
- **UIK_007** Setting `GETIT_A11Y=screen-reader` disables all spinners and animations; output remains line-oriented.
- **UIK_008** Resizing the terminal triggers a single `ResizeBus` event that propagates to all subscribed primitives within 50 ms.
- **UIK_009** Loading an invalid theme JSON does not crash; loader logs a warning and retains the previous theme.
- **UIK_010** With `glyphs='ascii'`, no codepoint above U+007E appears in rendered frames.

---

## 8c. Module H — Enhanced CLI Control Plane & UX

### 8c.1 Context & Rationale

v1.5's REPL is a single-line prompt with slash-commands. It works, but power users (and Brian's own iteration loop — 98+ PRs in a quarter) need a *control plane*: a single surface where every capability is one keystroke away, every state is observable, and every action is reversible.

Module H builds on TerminalKit primitives to deliver:

- A **command palette** (Ctrl-K) with fuzzy search across REPL commands, recipes, plugins, recent prompts, and learned shortcuts.
- An **omnibar** that auto-classifies input (slash command vs. natural-language prompt vs. recipe invocation vs. shell escape).
- **Contextual hints** beneath the prompt that surface the next likely action (open file, run tests, push branch).
- A **multi-line editor mode** (Ctrl-E) with syntax-aware paste detection and bracket matching for long prompts.
- A **macro recorder** (`/macro record … /macro stop`) that captures a sequence of prompts/commands and replays them on demand.
- A **status header** showing carrier, model, token budget, drift count, watch state, vault state, and active recipe — all click/tap-target-equivalent via single-letter focus jumps.
- An **undo timeline pane** showing the last N transactions with one-keystroke rollback.
- **Inline editor** integration: when MITL flags an `[e]` (edit) on a file mutation, the spec'd file is opened in a tk `Prompt`-backed editor without leaving the REPL.

### 8c.2 Layout (Default Layout B — supersedes §7.2 Layout A; selectable via `/layout`)

```
┌── getit ── theme:eclipse ── model:nemotron(F) ── tok:12.4k/64k ── drift:0 ── watch:●  ── vault:🔒 ──┐
│                                                                                                    │
│   [transcript pane]                                                              [insight pane]    │
│   ╭───────────────────────────────────────────────────╮  ╭───────────────────────────────────╮   │
│   │ user: refactor the carrier interface…              │  │ active recipe: none               │   │
│   │                                                    │  │ next likely: run tests            │   │
│   │ getit: I'll proceed in 3 steps:                    │  │   ↳ press T to invoke             │   │
│   │  1. read src/carriers/openrouter/client.ts         │  │ undo:                             │   │
│   │  2. update interface                               │  │  • c9f50d2 latency opt           │   │
│   │  3. run tests                                      │  │  • eb7014a sec fixes             │   │
│   │ [proceed? Y/n/e/c]                                 │  │  (z to rewind)                    │   │
│   ╰───────────────────────────────────────────────────╯  ╰───────────────────────────────────╯   │
│                                                                                                    │
├── omnibar ──────────────────────────────────────────────────────────────────────────────────────┤
│ › refactor carrier interface to support streaming chunks                          [press Ctrl-K]   │
├── hints ─────────────────────────────────────────────────────────────────────────────────────────┤
│  ↑ history   Ctrl-E multi-line   Ctrl-K palette   Tab complete   F2 focus pane   ?  help          │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

When width < 100 cols, the insight pane collapses behind `F3` toggle. When `simple=true`, the layout collapses to a flat scrolling transcript with the omnibar and a one-line status footer.

### 8c.3 Command Palette (`src/repl/control-plane/palette.ts`)

Triggered by `Ctrl-K`. Renders a `tk.Palette` overlay over the transcript pane. Sources:

1. **Built-in slash commands** (full set, with help line and key chord).
2. **Plugin tools** (from `PluginRegistry.list()` — see Module A).
3. **Recipes** (from recipe directory — see Module C). Listed with `▶` glyph.
4. **Recent prompts** (last 50 from session memory).
5. **Themes & layouts** (`/theme set <name>`, `/layout <id>`).
6. **Learned shortcuts** (top 10 most-used commands, from preference learning).

Scoring algorithm (`scoreEntry(query, entry)`):

```
score = wordPrefixHits * 8
      + camelOrSnakeHits * 4
      + substringHits * 2
      + recencyBonus(entry, now)              // up to +6 within 24h
      + frequencyBonus(entry)                 // up to +4 for top-3 used
      - typeDistancePenalty(query, entry)     // edit distance > 0
```

Top 12 results render with command, description, and *kbd hint* (e.g., `T`, `Ctrl-R`). `Enter` invokes; `Tab` inserts into the omnibar without invoking; `Esc` closes.

### 8c.4 Omnibar Input Classifier (`src/repl/control-plane/classifier.ts`)

```typescript
export type OmniIntent =
  | { kind: 'slash'; command: string; args: string }
  | { kind: 'recipe'; name: string; vars: Record<string, string> }
  | { kind: 'shell'; raw: string }            // input starts with `!`
  | { kind: 'pluginTool'; name: string; args: string }
  | { kind: 'prompt'; text: string };

export function classify(input: string, registry: Snapshot): OmniIntent;
```

Rules (first match wins):

1. Starts with `/` → `slash`.
2. Starts with `!` → `shell` (route through MITL `execute_bash` interception).
3. Single word matches `recipes/<name>.yaml` → `recipe`.
4. Single word matches a registered plugin tool → `pluginTool`.
5. Otherwise → `prompt`.

The classifier is *advisory*; the rendered omnibar shows a `tk.Text` badge to the left indicating the detected intent, and the user can override with explicit `/`, `!`, or `▶`. The classifier never executes — it only labels.

### 8c.5 Contextual Hints Engine (`src/repl/control-plane/hints.ts`)

After every agent turn, the hints engine computes 1–3 next-likely actions based on:

- Most recent tool invocations (e.g., if `manage_file` modified `src/**/*.ts`, suggest "run tests").
- Drift state (`manifest.unhealthy() === true` → "resolve drift").
- Watcher events queued in the notification queue.
- Recipe definitions in the project that reference files just touched.
- Preference learning: actions that this user historically takes after this kind of action.

Hints render as a strip beneath the omnibar with a one-letter chord (e.g., `T` = run tests, `R` = resolve drift, `P` = push branch). Pressing the chord inserts the corresponding command into the omnibar but does *not* auto-submit; the user always confirms.

### 8c.6 Multi-Line Editor Mode (`src/repl/control-plane/editor.ts`)

Triggered by `Ctrl-E` from the omnibar, or by typing a backslash at end-of-line. Opens a `tk.Pane` editor with:

- Bracket matching for `()`, `[]`, `{}`, ` `` `, `"""`.
- Auto-detect of pasted code blocks → triple-backtick wrapping with language guess (by shebang or first-line `import`/`def`/`fn`).
- `Ctrl-Enter` submits; `Esc` discards; `Ctrl-S` saves to `.getit/scratch/<timestamp>.md`.

### 8c.7 Macro Recorder (`src/repl/control-plane/macros.ts`)

```
/macro record <name>       # Start recording. Status bar shows ● REC.
/macro stop                # Save to .getit/macros/<name>.macro
/macro run <name>          # Replay (each step still passes through MITL)
/macro list
/macro delete <name>
```

A macro is a JSON file:

```json
{
  "name": "ship-pr",
  "steps": [
    { "kind": "prompt", "text": "summarize the changes since main" },
    { "kind": "slash", "command": "tests", "args": "" },
    { "kind": "shell", "raw": "git push origin HEAD" }
  ],
  "createdAt": "2026-05-24T20:00:00Z"
}
```

Macros differ from recipes: recipes are *project*-level YAML automations with parameters and gating; macros are *user*-level shortcut sequences for the REPL.

### 8c.8 Status Header & Focus Jumps

The top status header is interactive. Pressing the underlined letter in each segment jumps focus:

- `T` theme picker, `M` model picker, `B` token budget panel, `D` drift resolver, `W` watch toggle, `V` vault unlock.

When focus enters a pane, its border draws with `borderHot` and TerminalKit's `pulse` animation runs for two frames.

### 8c.9 Undo Timeline Pane

The insight pane's lower half shows the last 10 transactions from the shadow store (`backup/shadow-store.ts`). Each row: `<short-sha>  <relative-time>  <summary>`. Keybinds:

- `z` rewind to the previous transaction (calls `getit rollback <hash>` with confirmation).
- `Z` rewind to the selected row.
- `Enter` open transaction diff in the transcript pane.

### 8c.10 Keybinding Reference

| Chord | Action |
|---|---|
| `Ctrl-K` | Command palette |
| `Ctrl-E` | Multi-line editor |
| `Ctrl-R` | Recipe runner overlay |
| `Ctrl-/` | Toggle hints strip |
| `Ctrl-L` | Clear transcript |
| `Ctrl-D` | Quit (with unsaved-state guard) |
| `Tab` | Complete at cursor (omnibar or palette) |
| `Shift-Tab` | Cycle pane focus |
| `F1` | Help overlay |
| `F2` | Focus transcript pane |
| `F3` | Toggle insight pane |
| `F4` | Toggle status header |
| `z` / `Z` | Undo timeline navigation (when insight pane focused) |
| `?` | Inline cheat sheet |

All bindings are remappable via `.getit/keymap.json`.

### 8c.11 REPL Commands (additions)

```
/layout <id>               # Switch between A (linear), B (default split), C (dashboard)
/keymap edit               # Open keymap.json in inline editor
/macro …                   # (see §8c.7)
/hints [on|off]
/palette                   # Open palette (also Ctrl-K)
/focus <pane>              # Focus by name (transcript|insight|omnibar|status)
```

### 8c.12 Strict Acceptance Criteria

- **CTL_001** `Ctrl-K` opens the palette overlay within one frame; `Esc` closes it.
- **CTL_002** Palette query `"thm ec"` matches `/theme set eclipse` in top 3 results (fuzzy ordering verified).
- **CTL_003** Omnibar classifier returns `slash` for `/help`, `shell` for `!ls`, `recipe` for `ship-pr` when `.getit/recipes/ship-pr.yaml` exists, `pluginTool` for `read_url` when the plugin is registered, `prompt` otherwise.
- **CTL_004** Contextual hints surface "run tests" after any `manage_file` mutation under `src/**/*.{ts,tsx,js}`.
- **CTL_005** `/macro record … /macro stop` produces a valid macro JSON; `/macro run` replays every step through MITL.
- **CTL_006** Pressing `T` while the status header is focused opens the theme picker.
- **CTL_007** `z` in the undo timeline triggers `getit rollback <hash>` and prompts for confirmation via MITL.
- **CTL_008** All keybindings are documented in `?` cheat sheet and remappable via `keymap.json`.
- **CTL_009** Multi-line editor preserves indentation on paste and auto-wraps code blocks with language hint.
- **CTL_010** With `GETIT_SIMPLE_UI=true`, palette, hints, multi-line editor, and undo timeline degrade to slash-command equivalents with no UI artifacts.

---

## 8d. Module I — OpenRouter Free-Model Auto-Switcher

### 8d.1 Context & Rationale

v1.5 lets the user pin one OpenRouter model via `GETIT_MODEL`. In practice, OpenRouter's *free tier* fluctuates daily: models go up/down, rate-limits change, context windows differ, some models are abruptly rate-limited mid-session. Sticking to one free model is brittle.

Module I introduces an **Auto-Switcher** that:

1. Discovers free models from OpenRouter's `GET /api/v1/models` endpoint.
2. Capability-classifies them (chat, tool-use, JSON mode, context length).
3. Routes each request to the best free model for the *current task*, with **automatic fallback** on rate-limit, timeout, or content-policy errors.
4. Maintains per-model telemetry (success rate, latency p50/p95, tokens/sec, refusal rate) persisted to disk.
5. Lets the user override or pin via `/model` commands.
6. Surfaces routing decisions in the TerminalKit status header (e.g., `model:nemotron(F)` where `(F)` means "free, auto-routed").

Critical constraint: **zero new dependencies.** All HTTP uses `node:https`, JSON uses `JSON.parse`, persistence uses the existing atomic-write pattern.

### 8d.2 Catalog Service (`src/carriers/openrouter/catalog.ts`)

```typescript
export interface FreeModel {
  /** OpenRouter model id, e.g. "nvidia/nemotron-3-super-120b-a12b:free" */
  id: string;
  name: string;
  contextLength: number;
  modalities: ('text' | 'image' | 'tool_use' | 'json_mode')[];
  provider: string;
  free: true;
  toolUse: boolean;
  jsonMode: boolean;
  dailyLimit?: number;
  refreshedAt: number;
}

export class Catalog {
  /** Force refresh from the API (rate-limited to once per 10 min unless force=true). */
  refresh(force?: boolean): Promise<FreeModel[]>;
  list(): FreeModel[];
  get(id: string): FreeModel | null;
}
```

Refresh logic:

- `GET https://openrouter.ai/api/v1/models` with the user's API key.
- Filter `pricing.prompt === '0' && pricing.completion === '0'`.
- Persist to `.getit/cache/openrouter-catalog.json` with a 10-minute TTL.
- Stale catalog still serves `list()`; refresh runs in background after 10 min.
- Failed refresh logs a warning; previous catalog continues to serve.

### 8d.3 Capability Classifier

Each `FreeModel` is enriched with:

```typescript
export interface ClassifiedModel extends FreeModel {
  tier: 'coder-large' | 'coder-mid' | 'general-large' | 'general-mid' | 'small';
  roles: ('plan' | 'execute' | 'summarize' | 'review' | 'memory-compress')[];
  stability: number;       // [0,1] from telemetry (§8d.5)
}
```

Classification heuristics (no LLM call):

- `tier='coder-large'`: id contains `code|coder|nemotron|qwen.*coder|deepseek.*coder` AND `contextLength >= 64000`.
- `tier='general-large'`: `contextLength >= 64000` AND not coder-tagged.
- `tier='coder-mid'`: coder-tagged AND `contextLength >= 16000`.
- `tier='general-mid'`: `contextLength >= 16000`.
- `tier='small'`: otherwise.

Roles default by tier (`coder-large` → `['plan','execute','review']`; `general-large` → `['plan','summarize','memory-compress']`, etc.) and can be overridden via `.getitrc`.

### 8d.4 Router (`src/carriers/openrouter/router.ts`)

```typescript
export interface RouteRequest {
  role: 'plan' | 'execute' | 'summarize' | 'review' | 'memory-compress';
  estTokens: number;
  needsToolUse: boolean;
  needsJsonMode: boolean;
  pinnedId?: string;
}

export interface RouteDecision {
  primary: ClassifiedModel;
  fallbacks: ClassifiedModel[];
  reason: string;
}

export class Router {
  decide(req: RouteRequest): RouteDecision;
  recordSuccess(modelId: string, latencyMs: number, tokens: number): void;
  recordFailure(modelId: string, kind: FailureKind): void;
}

export type FailureKind =
  | 'rate-limit' | 'timeout' | 'content-policy' | 'tool-misuse'
  | 'context-exceeded' | 'unknown';
```

Selection ranking:

```
fitness = roleMatch(model, req) * 10
       + (model.contextLength >= req.estTokens * 1.5 ? 5 : -10)
       + (req.needsToolUse ? (model.toolUse ? 4 : -8) : 0)
       + (req.needsJsonMode ? (model.jsonMode ? 3 : -6) : 0)
       + model.stability * 6                       // [0,1] → up to 6
       + freshnessBonus(model)                     // recently successful
       - rateLimitPenalty(model, now)              // exponential cooldown
```

The top-ranked model becomes `primary`; the next three become `fallbacks`. Cooldowns:

- `rate-limit`: 60 s × 2^N (capped 30 min).
- `timeout`: 30 s.
- `content-policy`: 5 min (and de-prefer for the remainder of the session).
- `tool-misuse`: not penalized — fallback only.
- `context-exceeded`: model is excluded until request's estTokens drops below model's contextLength.

### 8d.5 Telemetry (`src/carriers/openrouter/telemetry.ts`)

Persistent file `.getit/cache/openrouter-telemetry.json` with rolling windows (last 200 calls per model):

```json
{
  "nvidia/nemotron-3-super-120b-a12b:free": {
    "calls": 187,
    "successes": 174,
    "rateLimits": 4,
    "timeouts": 2,
    "contentPolicy": 0,
    "p50LatencyMs": 1820,
    "p95LatencyMs": 4310,
    "tokensPerSec": 32.4,
    "lastSuccessAt": 1779657800000,
    "lastFailureAt": 1779655000000,
    "lastFailureKind": "rate-limit",
    "cooldownUntil": 1779658100000
  }
}
```

`stability = clamp01((successes/calls) * 0.7 + recencyTerm * 0.3)` where `recencyTerm` decays linearly over 24 h since last success.

Telemetry writes are atomic and debounced (max once per 2 s).

### 8d.6 Streaming Fallback Mid-Response

If the primary model fails *during streaming* (HTTP/2 stream abort, partial JSON tool call interrupted by 429), the router:

1. Records the failure.
2. Re-invokes the request against the first fallback with the **partial assistant output** discarded (we never silently merge partial outputs from two different models).
3. Surfaces a TerminalKit toast: `<warning>switched: nemotron → llama-3.1-405b (rate-limit)</warning>`.
4. Streaming resumes on the fallback.

Tool calls in flight when the primary aborts are *not* committed — the MITL gate has not been crossed yet because tool execution happens only on the assistant's `finish_reason === 'tool_calls'`. Partial tool JSON is dropped safely.

### 8d.7 Configuration

```ini
# ─── New in v2.0 (Module I) ───
GETIT_MODEL_MODE=auto              # auto | pinned
GETIT_MODEL=                       # if set and MODE=pinned, forced
GETIT_MODEL_TIER=auto              # auto | coder-large | general-large | …
GETIT_MODEL_BLACKLIST=             # comma-separated ids to exclude
GETIT_MODEL_WHITELIST=             # comma-separated ids (if set, only these eligible)
GETIT_MODEL_REFRESH_MIN=10         # catalog refresh TTL minutes
GETIT_MODEL_FAILOVER_MAX=3         # max in-request fallback hops (default 3)
GETIT_TELEMETRY=true               # persist telemetry to disk
```

### 8d.8 REPL Commands

```
/model                     # Show current routing decision + fallbacks + telemetry
/model list                # List free catalog with stability scores
/model pin <id>            # Override auto routing
/model unpin               # Return to auto
/model tier <id>           # Force a tier preference for this session
/model refresh             # Force a catalog refresh
/model blacklist add <id>
/model blacklist remove <id>
/model why                 # Explain why the last request used the model it did
```

`/model why` prints the routing decision's `reason`, the top 5 candidates with fitness scores, and the cooldown table.

### 8d.9 Status Header Integration

The model segment in the status header shows:

- `model:<short>(F)` for free auto-routed.
- `model:<short>(P)` for pinned.
- `model:<short>(F→F')` while a mid-response fallback is in flight.

Focusing the segment via `M` (see Module H §8c.8) opens a panel listing the primary + fallbacks with live latency sparklines (`tk.Sparkline`).

### 8d.10 Safety & Privacy

- Model id strings are *not* secrets and are emitted in logs unconditionally.
- Prompt content is scrubbed through `scrubText()` before any request as in v1.5 — unchanged.
- Telemetry never stores prompt or response content; only timings, token counts, and failure kinds.
- If `GETIT_TELEMETRY=false`, the telemetry file is not written and the router falls back to a constant `stability = 0.5` for all models.

### 8d.11 Failure Mode Matrix

| Failure | Detection | Action |
|---|---|---|
| HTTP 429 | `response.status === 429` | record `rate-limit`, set cooldown, fallback |
| HTTP 408 / `AbortError` | stream timeout | record `timeout`, set cooldown, fallback |
| HTTP 403 + content-policy body | regex on body | record `content-policy`, long cooldown, fallback |
| Stream truncated mid-token | invalid trailing JSON | record `unknown`, fallback |
| Tool call schema mismatch | post-parse validation | record `tool-misuse`, fallback once, then surface to user |
| Context overflow (HTTP 400 + body match) | regex `context|length|tokens` | record `context-exceeded`, exclude model, fallback to larger ctx |

### 8d.12 Strict Acceptance Criteria

- **OR_001** `Catalog.refresh()` returns only models with `pricing.prompt === '0' && pricing.completion === '0'`.
- **OR_002** Stale catalog (>10 min) triggers background refresh on next `list()` call; `list()` itself never blocks on network.
- **OR_003** `Router.decide({ role:'execute', needsToolUse:true })` never returns a model with `toolUse=false` as primary unless no tool-capable free model exists (in which case it surfaces a warning toast).
- **OR_004** A rate-limit response sets a cooldown ≥ 60 s and de-prefers the model in the next decision.
- **OR_005** Mid-stream failure switches to a fallback within one HTTP round-trip and emits a TerminalKit toast.
- **OR_006** `/model pin <id>` overrides all auto routing for the session; `/model unpin` restores auto.
- **OR_007** With `GETIT_MODEL_MODE=pinned` and a stale pin (model not in catalog), the router falls back to auto and prints a one-time warning.
- **OR_008** Telemetry persists to `.getit/cache/openrouter-telemetry.json` and is debounced to ≤ 1 write per 2 s.
- **OR_009** `GETIT_TELEMETRY=false` disables telemetry writes; `Router.stability` defaults to 0.5.
- **OR_010** `/model why` prints a structured explanation that names the primary model, the fitness score, the top 5 candidates, and any active cooldowns.

---

## 9. Cross-Cutting Concerns

### 9.1 Updated Project Structure

```
getit/
├── src/
│   ├── index.ts                 # Entry point (updated for new CLI subcommands)
│   ├── agent/
│   │   ├── client.ts            # (unchanged)
│   │   ├── loop.ts              # (modified: dynamic tool schemas, memory injection)
│   │   ├── prompt.ts            # (modified: memory context, project context, preferences)
│   │   └── tools.ts             # (modified: dynamic getToolSchemas())
│   ├── carriers/                # (unchanged)
│   ├── discovery/               # (unchanged)
│   ├── execution/               # (unchanged)
│   ├── memory/                  # ← NEW
│   │   ├── sessions.ts          # Session summary compression and storage
│   │   ├── projects.ts          # Project context fingerprinting
│   │   └── preferences.ts       # Preference learning and tracking
│   ├── mitl/
│   │   └── interceptor.ts       # (modified: new InterceptionContext types)
│   ├── planning/
│   │   └── plan-queue.ts        # (modified: plugin tool name support)
│   ├── plugins/                 # ← NEW
│   │   ├── types.ts             # PluginToolDefinition interface
│   │   ├── loader.ts            # Plugin discovery and compilation
│   │   ├── registry.ts          # PluginRegistry singleton
│   │   └── validator.ts         # Schema and name validation
│   ├── recipes/                 # ← NEW
│   │   ├── types.ts             # Recipe schema interfaces
│   │   ├── engine.ts            # Recipe execution engine
│   │   ├── yaml-parser.ts       # Minimal zero-dep YAML parser
│   │   └── recorder.ts          # Interactive recipe recording
│   ├── runtime/
│   │   └── session.ts           # (modified: vault unlock state, watch mode flag)
│   ├── security/                # (unchanged — plugins route through existing pipeline)
│   ├── setup/                   # (unchanged)
│   ├── sync/                    # ← NEW
│   │   ├── profiles.ts          # Profile-based sync logic
│   │   └── merge.ts             # Three-way merge engine
│   ├── tools/
│   │   ├── registry.ts          # (modified: plugin dispatch fallback)
│   │   ├── execute-bash.ts      # (unchanged)
│   │   ├── manage-file.ts       # (unchanged)
│   │   └── diff.ts              # (unchanged)
│   ├── repl/                    # ← NEW (Module H)
│   │   └── control-plane/
│   │       ├── palette.ts       # Command palette (Ctrl-K)
│   │       ├── classifier.ts    # Omnibar intent classifier
│   │       ├── hints.ts         # Contextual hint engine
│   │       ├── editor.ts        # Multi-line inline editor
│   │       ├── macros.ts        # Macro recorder/runner
│   │       └── keymap.ts        # Keymap loader (.getit/keymap.json)
│   ├── ui/
│   │   ├── layout.ts            # (unchanged)
│   │   ├── spinner.ts           # (unchanged)
│   │   ├── dashboard.ts         # ← NEW: Rich TUI dashboard (Module E)
│   │   ├── panes.ts             # ← NEW: Pane management (Module E)
│   │   └── terminalkit/         # ← NEW (Module G)
│   │       ├── ansi.ts          # Hand-rolled ANSI emitter
│   │       ├── capabilities.ts  # detectCapabilities()
│   │       ├── surface.ts       # Double-buffered diff renderer
│   │       ├── markup.ts        # <accent>…</accent> micro-markup
│   │       ├── animate.ts       # Pull-based Ticker + animations
│   │       ├── glyphs.ts        # Unicode/Nerd Font/ASCII glyph sets
│   │       ├── themes/
│   │       │   ├── types.ts
│   │       │   └── builtin/     # eclipse, solar, mono, forge, meadow, vapor
│   │       └── primitives/      # box, pane, text, list, progress,
│   │                            # sparkline, spinner, toast, modal,
│   │                            # prompt, palette, diff
│   ├── carriers/openrouter/     # (existing client.ts plus new files)
│   │   ├── catalog.ts           # ← NEW (Module I): free-model catalog
│   │   ├── router.ts            # ← NEW (Module I): routing + fallback
│   │   └── telemetry.ts         # ← NEW (Module I): per-model stats
│   ├── vault/                   # ← NEW
│   │   └── vault.ts             # AES-256-GCM encrypted secrets store
│   ├── watcher/                 # ← NEW
│   │   ├── daemon.ts            # Watch mode orchestrator
│   │   ├── build.ts             # Build watcher
│   │   ├── drift.ts             # Drift sentinel
│   │   ├── hooks.ts             # Git hook manager
│   │   └── notifications.ts     # Notification queue
│   └── workspace/               # (unchanged)
├── tests/
│   ├── ... (existing 26 test files unchanged)
│   ├── plugins-loader.test.ts         # ← NEW
│   ├── plugins-dispatch.test.ts       # ← NEW
│   ├── plugins-registry.test.ts       # ← NEW
│   ├── memory-sessions.test.ts        # ← NEW
│   ├── memory-projects.test.ts        # ← NEW
│   ├── memory-preferences.test.ts     # ← NEW
│   ├── recipes-parser.test.ts         # ← NEW
│   ├── recipes-engine.test.ts         # ← NEW
│   ├── recipes-recorder.test.ts       # ← NEW
│   ├── watcher-build.test.ts          # ← NEW
│   ├── watcher-drift.test.ts          # ← NEW
│   ├── watcher-hooks.test.ts          # ← NEW
│   ├── sync-vault.test.ts             # ← NEW
│   ├── sync-merge.test.ts             # ← NEW
│   ├── sync-profiles.test.ts          # ← NEW
│   ├── ui-dashboard.test.ts           # ← NEW
│   ├── ui-terminalkit-capabilities.test.ts  # ← NEW (UIK_001, UIK_006, UIK_007)
│   ├── ui-terminalkit-surface.test.ts       # ← NEW (UIK_005, UIK_008)
│   ├── ui-terminalkit-markup.test.ts        # ← NEW (UIK_004)
│   ├── ui-terminalkit-themes.test.ts        # ← NEW (UIK_002, UIK_003, UIK_009, UIK_010)
│   ├── repl-palette.test.ts                 # ← NEW (CTL_001, CTL_002)
│   ├── repl-classifier.test.ts              # ← NEW (CTL_003)
│   ├── repl-hints.test.ts                   # ← NEW (CTL_004)
│   ├── repl-macros.test.ts                  # ← NEW (CTL_005)
│   ├── repl-keymap.test.ts                  # ← NEW (CTL_008, CTL_010)
│   ├── repl-editor.test.ts                  # ← NEW (CTL_009)
│   ├── openrouter-catalog.test.ts           # ← NEW (OR_001, OR_002)
│   ├── openrouter-router.test.ts            # ← NEW (OR_003, OR_004, OR_006, OR_007)
│   ├── openrouter-fallback.test.ts          # ← NEW (OR_005)
│   └── openrouter-telemetry.test.ts         # ← NEW (OR_008, OR_009, OR_010)
├── dist/
├── package.json
├── tsconfig.json
├── CHANGELOG.md
├── V2_SPEC.md                         # ← This document
└── README.md
```

### 9.2 Updated CLI Subcommands

```
getit                              # Start interactive REPL (unchanged)
getit "<prompt>"                   # One-shot mode (unchanged)
getit --dry-run "<prompt>"         # Dry-run mode (unchanged)
getit --setup                      # Setup wizard (unchanged)
getit undo                         # Undo last transaction (unchanged)
getit --profile <strict|normal>    # Security profile (unchanged)
getit config                       # Show config (unchanged)
getit doctor                       # Health check (unchanged)
getit models                       # List models (unchanged)
getit manifest init                # Initialize workspace (unchanged)
getit status                       # Drift status (unchanged)
getit inspect <file>               # View scrubbed tracking (unchanged)
getit export [dir]                 # Export tracked files (unchanged)
getit resolve                      # Interactive drift resolution (unchanged)
getit history                      # Shadow Git history (unchanged)
getit rollback <hash>              # Rollback to shadow commit (unchanged)

# ─── New in v2.0 ───
getit run <recipe> [--var k=v]     # Execute a task recipe
getit watch [--build] [--drift]    # Start watch mode
getit hooks install                # Install git hooks
getit hooks remove                 # Remove git hooks
getit hooks status                 # Show installed hooks
getit hook <pre-commit|pre-push>   # Internal: invoked by git hooks
getit vault init                   # Initialize encrypted vault
getit vault status                 # Show vault entry count (not contents)
getit sync status                  # Show sync state
getit sync push                    # Push to remote
getit sync pull                    # Pull from remote
getit sync resolve                 # Interactive conflict resolution

# ─── New in v2.0 (Module G — TerminalKit) ───
getit theme list                   # List built-in + user themes
getit theme set <name>             # Persist theme to .getitrc
getit theme preview <name>         # Render a sampler without committing
getit theme export <name>          # Print theme JSON
getit ui doctor                    # Print detected TerminalCapabilities

# ─── New in v2.0 (Module H — Control Plane) ───
getit palette                      # Launch one-shot palette (non-REPL)
getit macro list
getit macro run <name>
getit keymap show

# ─── New in v2.0 (Module I — OpenRouter Auto-Switcher) ───
getit model                        # Show current decision + telemetry
getit model list                   # List free catalog with stability
getit model refresh                # Force a catalog refresh
getit model pin <id>               # Persist a pinned model
getit model unpin                  # Return to auto
getit model why                    # Explain last routing decision
```

### 9.3 Updated `.getitrc` Configuration

```ini
# ─── Existing (unchanged) ───
GETIT_CARRIER=openrouter
GETIT_API_KEY=your-api-key
GETIT_MODEL=nvidia/nemotron-3-super-120b-a12b:free
GETIT_TIMEOUT=60000

# ─── New in v2.0 ───
# Memory
GETIT_MEMORY_ENABLED=true                 # Enable/disable session memory (default: true)
GETIT_SUMMARIZE_WITH_LLM=false            # Use LLM for session summaries (default: false)
GETIT_MAX_SESSION_SUMMARIES=50            # Max stored sessions (default: 50)

# Plugins
GETIT_PLUGINS_ENABLED=true                # Enable/disable plugin system (default: true)
GETIT_PLUGIN_TIMEOUT=30000                # Plugin execution timeout ms (default: 30000)

# Watch
GETIT_WATCH_BUILD_CMD=                    # Override auto-detected build command
GETIT_WATCH_DEBOUNCE_MS=500               # File change debounce ms (default: 500)
GETIT_WATCH_IGNORE=node_modules,dist,.git # Comma-separated ignore dirs

# UI
GETIT_SIMPLE_UI=false                     # Force simple linear UI (default: false)

# Sync
GETIT_SYNC_REMOTE=origin                  # Git remote name for sync (default: origin)

# ─── Module G — TerminalKit ───
GETIT_THEME=eclipse                       # Active theme name
GETIT_GLYPHS=auto                         # auto | unicode | nerdfont | ascii
GETIT_A11Y=none                           # none | high-contrast | screen-reader
GETIT_ANIMATIONS=true                     # Master enable for animations
GETIT_ANIMATION_MS=120                    # Frame rate cap (lower = smoother)

# ─── Module H — Control Plane ───
GETIT_LAYOUT=B                            # A (linear) | B (split, default) | C (dashboard)
GETIT_HINTS=true                          # Contextual hints on/off
GETIT_KEYMAP=.getit/keymap.json           # Path to user keymap overrides

# ─── Module I — OpenRouter Auto-Switcher ───
GETIT_MODEL_MODE=auto                     # auto | pinned
GETIT_MODEL_TIER=auto                     # auto | coder-large | coder-mid | general-large | general-mid | small
GETIT_MODEL_BLACKLIST=                    # comma-separated ids
GETIT_MODEL_WHITELIST=                    # comma-separated ids
GETIT_MODEL_REFRESH_MIN=10                # catalog refresh TTL in minutes
GETIT_MODEL_FAILOVER_MAX=3                # max fallback hops per request
GETIT_TELEMETRY=true                      # write per-model telemetry to disk
```

### 9.4 Updated `RuntimeSession`

```typescript
// src/runtime/session.ts (v2.0 — additions)

export interface RuntimeSession {
  // ─── Existing fields (unchanged) ───
  promptId: string;
  transactionId: string;
  dryRun: boolean;
  approvedPlanIds: Set<string>;
  planQueue: PlanQueue;
  maskingSession: MaskingSession;
  policyProfile: PolicyProfile;
  mitlActive: boolean;
  processActive: boolean;
  suppressMitl: boolean;

  // ─── New in v2.0 ───
  /** Whether watch mode watchers are active. */
  watchActive: boolean;
  /** Whether the vault has been unlocked this session. */
  vaultUnlocked: boolean;
  /** Whether recipe recording mode is active. */
  recipeRecording: boolean;
  /** Currently executing recipe name (null if no recipe running). */
  activeRecipe: string | null;
}
```

### 9.5 Backward Compatibility

All v1.5 behavior is preserved:

- The two built-in tools (`execute_bash`, `manage_file`) are unchanged in interface and behavior.
- All existing REPL commands work identically.
- All existing CLI subcommands work identically.
- The security pipeline (scrubber, path policy, input sanitizer, MITL gate) is unchanged — only extended with new interception contexts.
- All 114 existing tests must continue to pass without modification.
- Users who don't create `.getit/tools/`, `.getit/recipes/`, or use new commands experience zero behavioral difference.

---

## 10. Migration from v1.5

### 10.1 Breaking Changes

**None.** v2.0 is a strict superset of v1.5.

### 10.2 package.json Version Bump

```json
{
  "version": "2.0.0"
}
```

### 10.3 Migration Steps for Users

1. Update to v2.0: `npm update -g getit` or `git pull && npm run build`.
2. Optionally create `.getit/tools/` for plugins.
3. Optionally create `.getit/recipes/` for task recipes.
4. Memory system activates automatically on first session exit.

---

## 11. Implementation Roadmap

### 11.1 Phased Delivery

Implementation MUST proceed in this order. Each phase builds on the previous.

```
┌────────────────────────────────────────────────────────────────────────┐
│ Phase 1: Plugin Tool Registry (Module A)                [Est: 1 week] │
│  Deliverables:                                                         │
│  - src/plugins/types.ts, loader.ts, registry.ts, validator.ts          │
│  - Modified: src/tools/registry.ts, src/agent/tools.ts                 │
│  - Modified: src/mitl/interceptor.ts (new context types)               │
│  - Tests: plugins-loader.test.ts, plugins-dispatch.test.ts,            │
│           plugins-registry.test.ts                                     │
│  Gate: All PLG_001–PLG_010 acceptance criteria pass.                   │
├────────────────────────────────────────────────────────────────────────┤
│ Phase 2: Session Memory (Module B)                      [Est: 1 week] │
│  Deliverables:                                                         │
│  - src/memory/sessions.ts, projects.ts, preferences.ts                 │
│  - Modified: src/agent/prompt.ts, src/runtime/session.ts               │
│  - Tests: memory-sessions.test.ts, memory-projects.test.ts,            │
│           memory-preferences.test.ts                                   │
│  Gate: All MEM_001–MEM_010 acceptance criteria pass.                   │
├────────────────────────────────────────────────────────────────────────┤
│ Phase 3: Task Recipes (Module C)                       [Est: 3–5 days]│
│  Deliverables:                                                         │
│  - src/recipes/types.ts, engine.ts, yaml-parser.ts, recorder.ts        │
│  - Tests: recipes-parser.test.ts, recipes-engine.test.ts,              │
│           recipes-recorder.test.ts                                     │
│  Gate: All RCP_001–RCP_008 acceptance criteria pass.                   │
├────────────────────────────────────────────────────────────────────────┤
│ Phase 4: Watch Mode (Module D)                         [Est: 4–5 days]│
│  Deliverables:                                                         │
│  - src/watcher/daemon.ts, build.ts, drift.ts, hooks.ts,                │
│    notifications.ts                                                    │
│  - Tests: watcher-build.test.ts, watcher-drift.test.ts,                │
│           watcher-hooks.test.ts                                        │
│  Gate: All WCH_001–WCH_008 acceptance criteria pass.                   │
├────────────────────────────────────────────────────────────────────────┤
│ Phase 5: Rich TUI (Module E)                           [Est: 1 week]  │
│  Deliverables:                                                         │
│  - src/ui/dashboard.ts, src/ui/panes.ts                                │
│  - Tests: ui-dashboard.test.ts                                         │
│  Gate: All TUI_001–TUI_007 acceptance criteria pass.                   │
├────────────────────────────────────────────────────────────────────────┤
│ Phase 6: Multi-Machine Sync (Module F)                 [Est: 1.5 weeks]│
│  Deliverables:                                                         │
│  - src/vault/vault.ts, src/sync/profiles.ts, src/sync/merge.ts         │
│  - Tests: sync-vault.test.ts, sync-merge.test.ts, sync-profiles.test.ts│
│  Gate: All SYN_001–SYN_008 acceptance criteria pass.                   │
├────────────────────────────────────────────────────────────────────────┤
│ Phase 7: TerminalKit UI Shell (Module G)               [Est: 1 week]  │
│  Deliverables:                                                         │
│  - src/ui/terminalkit/{ansi,capabilities,surface,markup,animate,       │
│    glyphs}.ts                                                          │
│  - src/ui/terminalkit/themes/{types.ts, builtin/*.json}                │
│  - src/ui/terminalkit/primitives/*                                     │
│  - Modified: src/ui/dashboard.ts + src/ui/panes.ts now render against  │
│    TerminalKit primitives (Module E retrofit)                          │
│  - Tests: ui-terminalkit-* (4 files)                                   │
│  Gate: All UIK_001–UIK_010 acceptance criteria pass.                   │
├────────────────────────────────────────────────────────────────────────┤
│ Phase 8: Control Plane & UX (Module H)                 [Est: 1 week]  │
│  Deliverables:                                                         │
│  - src/repl/control-plane/{palette,classifier,hints,editor,macros,     │
│    keymap}.ts                                                          │
│  - Modified: REPL entry point to mount control-plane surfaces          │
│  - Tests: repl-* (6 files)                                             │
│  Gate: All CTL_001–CTL_010 acceptance criteria pass.                   │
├────────────────────────────────────────────────────────────────────────┤
│ Phase 9: OpenRouter Auto-Switcher (Module I)           [Est: 4–6 days]│
│  Deliverables:                                                         │
│  - src/carriers/openrouter/{catalog,router,telemetry}.ts               │
│  - Modified: src/carriers/openrouter/client.ts to consult Router       │
│    before each request and on stream failure                           │
│  - Modified: src/agent/loop.ts to thread RouteRequest derived from     │
│    current turn (role/estTokens/needsToolUse)                          │
│  - Tests: openrouter-* (4 files)                                       │
│  Gate: All OR_001–OR_010 acceptance criteria pass.                     │
└────────────────────────────────────────────────────────────────────────┘

Phases 7–9 may proceed in parallel with each other *after* Phase 5 lands, since
they share no source files. Phase 8 (Module H) depends on Phase 7 (Module G)
primitives. Phase 9 (Module I) is fully independent of Phases 7–8 and may be
delivered first if model reliability is the higher pain point.
```

### 11.2 Milestone Verification

After each phase, the implementation agent MUST:

1. Run `npm test` — all existing + new tests pass.
2. Run `npm run build` — zero TypeScript errors.
3. Verify zero production dependencies: `jq '.dependencies // {} | length' package.json` returns `0`.
4. Manual smoke test: start the REPL and verify the new features work interactively.

---

## 12. Complete Acceptance Test Matrix

### 12.1 New Test Files Summary

| Test File | Module | Test Count (min) |
|---|---|---|
| `plugins-loader.test.ts` | A | 8 |
| `plugins-dispatch.test.ts` | A | 10 |
| `plugins-registry.test.ts` | A | 6 |
| `memory-sessions.test.ts` | B | 8 |
| `memory-projects.test.ts` | B | 10 |
| `memory-preferences.test.ts` | B | 6 |
| `recipes-parser.test.ts` | C | 8 |
| `recipes-engine.test.ts` | C | 10 |
| `recipes-recorder.test.ts` | C | 4 |
| `watcher-build.test.ts` | D | 6 |
| `watcher-drift.test.ts` | D | 6 |
| `watcher-hooks.test.ts` | D | 8 |
| `sync-vault.test.ts` | F | 8 |
| `sync-merge.test.ts` | F | 8 |
| `sync-profiles.test.ts` | F | 6 |
| `ui-dashboard.test.ts` | E | 6 |
| **Total new tests** | | **≥ 128** |

Combined with the existing 114 tests, v2.0 ships with **≥ 242 tests**.

### 12.2 Test Specification Details

#### Plugin Loader Tests (`plugins-loader.test.ts`)

1. Valid `.ts` plugin in `.getit/tools/` is loaded and registered.
2. Plugin with invalid name (uppercase, special chars) is rejected with warning.
3. Plugin colliding with `execute_bash` is rejected.
4. Plugin colliding with `manage_file` is rejected.
5. Workspace plugin overrides global plugin with same name.
6. Plugin with missing `execute` function is rejected.
7. Plugin with `description` > 500 chars is rejected.
8. `reload()` picks up newly added plugin files.

#### Plugin Dispatch Tests (`plugins-dispatch.test.ts`)

1. Read-risk plugin executes without MITL prompt.
2. Write-risk plugin triggers MITL `[Y/n/e/c]` gate.
3. System-risk plugin triggers enhanced MITL gate.
4. Plugin output is scrubbed before LLM context.
5. Plugin that throws Error returns error content without halting turn.
6. Plugin exceeding 30s timeout is terminated.
7. Plugin with custom `formatApprovalCard` renders correctly in MITL.
8. Plugin with `validate` that throws rejects before MITL gate.
9. Denied plugin returns denial reason in content.
10. Plugin in dry-run mode (write-risk) is queued in PlanQueue.

#### Memory Session Tests (`memory-sessions.test.ts`)

1. Session summary is created on clean REPL exit.
2. Summary includes correct `turnCount` and `toolCallCount`.
3. Summary includes `filesModified` from manage_file calls.
4. Summary includes `packagesInstalled` from install commands.
5. Summary includes `deniedActions` from MITL denials.
6. Summary content is scrubbed (no API keys in output).
7. Oldest summary is deleted when 50-summary limit is exceeded.
8. `loadRecentSessions(3)` returns most recent 3.

#### Memory Projects Tests (`memory-projects.test.ts`)

1. `package.json` triggers `node` type detection.
2. `tsconfig.json` triggers `typescript` type detection.
3. `Cargo.toml` triggers `rust` type detection.
4. `pyproject.toml` triggers `python` type detection.
5. `go.mod` triggers `go` type detection.
6. Scripts are extracted from `package.json`.
7. Dependencies are extracted from `package.json`.
8. `.nvmrc` is parsed for Node version.
9. User notes are persisted and loaded.
10. Project context scanning completes in < 500ms for 10 marker files.

#### Recipe Parser Tests (`recipes-parser.test.ts`)

1. Valid recipe YAML parses into correct `Recipe` structure.
2. Template variables `{{var}}` are resolved from provided values.
3. Missing required variable throws validation error.
4. Default variable values are used when not overridden.
5. `skip_if` field is preserved in parsed step.
6. `depends_on` references are validated against step IDs.
7. Invalid YAML (unclosed quotes, bad indentation) throws parse error.
8. Parser implementation is ≤ 300 lines.

#### Vault Tests (`sync-vault.test.ts`)

1. `encryptVault` + `decryptVault` round-trips correctly.
2. Wrong passphrase throws authentication error.
3. Vault file format is `[salt:32][iv:16][tag:16][ciphertext]`.
4. Empty vault (no entries) encrypts and decrypts correctly.
5. Vault with 100 entries encrypts in < 100ms.
6. Corrupted ciphertext (single bit flip) throws authentication error.
7. Each encryption produces different ciphertext (random salt + IV).
8. Vault entries with special characters (unicode, newlines) round-trip correctly.

#### Merge Tests (`sync-merge.test.ts`)

1. Identical local and remote produces no conflict.
2. Local-only changes produce a clean merge favoring local.
3. Remote-only changes produce a clean merge favoring remote.
4. Both-modified same line triggers conflict with `[l/r/m/a]` options.
5. `[l]` keeps local version entirely.
6. `[r]` keeps remote version entirely.
7. Three-way diff shows base, local, and remote sections.
8. Merge output is scrubbed before display.

---

## Prompt Instructions for the Agentic Coding Agent

When implementing this specification, adhere to these absolute constraints:

1. **Zero Production Dependencies.** `package.json` `dependencies` must remain empty. Use only `node:*` built-in modules. If you need YAML parsing, write it. If you need encryption, use `node:crypto`. If you need file watching, use `node:fs`.

2. **Leverage Existing Infrastructure.** Do not reinvent:
   - Path validation → use `assertPathAllowed()` from `src/security/path-policy.ts`
   - Secret scrubbing → use `scrubText()` and `StreamScrubber` from `src/security/scrubber.ts`
   - MITL approval → use `interceptToolCall()` from `src/mitl/interceptor.ts`
   - File hashing → use `sha256()` from `src/backup/shadow-store.ts`
   - Atomic writes → use the `atomicWriteFile()` pattern from `src/tools/manage-file.ts`
   - Environment detection → use `discoverEnvironment()` from `src/discovery/environment.ts`
   - Workspace root discovery → use `findWorkspaceRoot()` from `src/workspace/boundary.ts`

3. **Test-Mode Bypass.** All new MITL interactions must respect `process.env.GETIT_TEST_MODE === 'true'` for automated testing.

4. **Error Boundaries.** Plugin crashes, recipe step failures, and watcher errors must never crash the main REPL process. Catch, log, and continue.

5. **TypeScript Strict Mode.** All new files must compile under `strict: true` with zero `any` types in public interfaces (internal implementation `any` is acceptable where necessary for JSON parsing).

6. **Implement in Order.** Follow the phased roadmap (§11.1). Each phase's acceptance criteria must pass before starting the next phase.

7. **Modify, Don't Replace.** When modifying existing files (`registry.ts`, `tools.ts`, `prompt.ts`, `session.ts`, `interceptor.ts`, `plan-queue.ts`), make surgical additions. Do not rewrite existing logic. The 114 existing tests must continue to pass at every phase.

---

*End of Specification*
