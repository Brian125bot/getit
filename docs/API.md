# API Reference — getit v2.0

> Complete public API reference for all core modules, interfaces, and function exports in getit v2.0.

---

## Table of Contents

- [Agent Layer](#agent-layer)
- [Plugins System](#plugins-system)
- [Session & Project Memory](#session--project-memory)
- [Task Recipes](#task-recipes)
- [Watcher Mode](#watcher-mode)
- [Encrypted Vault](#encrypted-vault)
- [Multi-Machine Sync](#multi-machine-sync)
- [TerminalKit UI & Dashboard](#terminalkit-ui--dashboard)
- [REPL Control Plane](#repl-control-plane)
- [OpenRouter Router & Carriers](#openrouter-router--carriers)
- [Guardrails & Security](#guardrails--security)
- [Tools & Dispatch](#tools--dispatch)
- [Workspace & Backup](#workspace--backup)

---

## Agent Layer

### `src/agent/loop.ts`

#### `class AgentLoop`

Manages multi-turn conversations, system prompt assembly, tool dispatching, and turn iterations.

```typescript
class AgentLoop {
  constructor(systemPrompt: string);

  // Returns conversation message history including tool call turns
  getMessages(): ChatMessage[];

  // Resets conversation history and updates system prompt
  resetSession(systemPrompt: string): void;

  // Appends a direct message to history without executing an LLM turn
  addDirectMessage(role: 'user' | 'assistant' | 'system', content: string): void;

  // Executes a prompt turn, streaming tokens, invoking tools, and enforcing runaway limits
  async runTurn(userInput: string): Promise<void>;
}
```

### `src/agent/prompt.ts`

#### `buildSystemPrompt(): string`

Constructs system prompt injected with environmental context (platform, CPU architecture, binaries), active project tech stack memory, user preferences, and loaded plugin schemas.

---

## Plugins System

### `src/plugins/types.ts`

```typescript
export type PluginRiskLevel = 'read' | 'write' | 'system';

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

export interface PluginExecutionResult {
  output: unknown;
  halt?: boolean;
  clarify?: string;
}

export interface PluginToolDefinition {
  name: string;
  description: string;
  parameters: PluginParameterSchema;
  risk: PluginRiskLevel;
  execute: (args: Record<string, unknown>) => Promise<PluginExecutionResult>;
  formatApprovalCard?: (args: Record<string, unknown>) => string;
  validate?: (args: Record<string, unknown>) => void | Promise<void>;
}
```

### `src/plugins/registry.ts`

- `initPluginRegistry(workspaceRoot?: string): Promise<void>` — Initializes plugin discovery across local (`.getit/tools/`) and global (`~/.config/getit/tools/`) paths.
- `registerPlugin(plugin: PluginToolDefinition): void` — Registers a plugin definition.
- `getPlugin(name: string): PluginToolDefinition | undefined` — Retrieves a plugin definition by tool name.
- `getAllPlugins(): PluginToolDefinition[]` — Returns all registered plugins.
- `executePlugin(name: string, args: Record<string, unknown>): Promise<PluginExecutionResult>` — Executes a plugin tool with validation and error handling.
- `reloadPlugins(workspaceRoot?: string): Promise<void>` — Resets registry and reloads plugins from disk.

---

## Session & Project Memory

### `src/memory/sessions.ts`

- `initSessionMemory(workspaceRoot?: string): Promise<void>` — Initializes session NDJSON logging in `.getit/session-history.ndjson`.
- `recordToolCall(toolName: string, success: boolean): Promise<void>` — Records a tool execution event.
- `buildSessionContext(): string` — Builds formatted session context string for prompt injection.

### `src/memory/projects.ts`

- `initProjectMemory(workspaceRoot: string): Promise<void>` — Detects workspace tech stack (languages, package managers, frameworks).
- `getCurrentProject(): ProjectMemory | null` — Returns detected project memory structure.
- `buildProjectContext(): string` — Builds formatted project context string for system prompt injection.

### `src/memory/preferences.ts`

- `loadPreferences(): Promise<UserPreferences>` — Loads learned/custom user preferences from `~/.config/getit/preferences.json`.
- `savePreferences(prefs: UserPreferences): Promise<void>` — Persists preferences to disk.
- `setPreference(key: string, value: unknown): Promise<UserPreferences>` — Updates a single preference key.
- `buildPreferencesContext(prefs?: UserPreferences): string` — Builds user preferences context string.

---

## Task Recipes

### `src/recipes/types.ts`

```typescript
export interface RecipeStep {
  tool: string;
  args: Record<string, unknown>;
  description?: string;
}

export interface TaskRecipe {
  name: string;
  description: string;
  version?: string;
  steps: RecipeStep[];
  source?: 'workspace' | 'global';
}
```

### `src/recipes/engine.ts`

- `discoverRecipes(workspaceRoot: string): Promise<TaskRecipe[]>` — Discovers recipe YAML files in `.getit/recipes/` and `~/.config/getit/recipes/`.
- `loadRecipe(filePath: string): Promise<TaskRecipe>` — Parses and validates a recipe file.
- `executeRecipe(recipe: TaskRecipe, options?: Record<string, unknown>, callbacks?: RecipeCallbacks): Promise<void>` — Replays recipe steps sequentially through dispatch.

---

## Watcher Mode

### `src/watcher/daemon.ts`

```typescript
export class WatchDaemon extends EventEmitter {
  constructor(targetDir: string, options?: WatchDaemonOptions);
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
}
```

Emits events: `started`, `stopped`, `change`, `ignored`, `error`.

---

## Encrypted Vault

### `src/vault/vault.ts`

- `vaultExists(): Promise<boolean>` — Returns true if vault file exists in `~/.config/getit/vault.enc`.
- `createVault(passphrase: string): Promise<void>` — Initializes a new AES-256-GCM vault with PBKDF2 salt and key derivation.
- `unlockVault(passphrase: string): Promise<void>` — Unlocks vault in memory.
- `lockVault(): void` — Locks vault and clears in-memory keys.
- `isVaultUnlocked(): boolean` — Checks unlock state.
- `setVaultEntry(key: string, value: string, category?: VaultCategory): Promise<void>` — Stores an entry.
- `getVaultEntry(key: string): VaultEntry | undefined` — Retrieves an entry.
- `deleteVaultEntry(key: string): Promise<boolean>` — Removes an entry.
- `listVaultEntries(): VaultEntry[]` — Lists all entries without decrypting sensitive values.

---

## Multi-Machine Sync

### `src/sync/profiles.ts`

- `createProfile(name: string, carrierConfig: CarrierConfig, preferences?: Record<string, unknown>): Promise<SyncProfile>` — Packages configuration and preferences into a sync profile.
- `loadProfile(name: string): Promise<SyncProfile | null>` — Loads a sync profile from disk.
- `listProfiles(): Promise<SyncProfile[]>` — Lists available sync profiles.

---

## TerminalKit UI & Dashboard

### `src/ui/dashboard.ts`

- `renderDashboard(state: DashboardState): string` — Renders multi-pane ASCII/ANSI TUI dashboard.

### `src/ui/terminalkit/`

- `src/ui/terminalkit/ansi.ts` — ANSI SGR escape code primitives, 256/RGB colors, visible width calculation, text truncation.
- `src/ui/terminalkit/surface.ts` — 2D text buffer surface for box layout and rendering.
- `src/ui/terminalkit/markup.ts` — Lightweight markup syntax parser (`<b>`, `<color>`, `<dim>`).
- `src/ui/terminalkit/animate.ts` — Terminal spinner, progress bar, and pulse animation utilities.

---

## REPL Control Plane

### `src/repl/control-plane/`

- `palette.ts`: `registerBuiltinCommands()`, `searchPalette(query, limit)`, `renderPalette(results, query)`.
- `classifier.ts`: `classifyInput(input)` — Categorizes input as slash command, natural prompt, shell command, or recipe trigger.
- `editor.ts`: Multi-line prompt editing component.
- `hints.ts`: Auto-complete contextual hints generator.
- `macros.ts`: `defineMacro(name, commandSequence)`, `expandMacro(input)`.

---

## OpenRouter Router & Carriers

### `src/carriers/openrouter/router.ts`

- `selectOptimalModel(taskType: TaskCategory, requirements?: ModelRequirements): Promise<ModelSelection>` — Selects best model based on task complexity, context window, and cost limits.

---

## Guardrails & Security

### `src/security/guardrail-engine.ts`

- `loadWorkspacePolicy(workspaceRoot: string): Promise<GuardrailPolicy | null>` — Loads `.getit/policy.json`.
- `evaluateGuardrails(workspaceRoot: string, modifiedFiles: string[]): Promise<GuardrailViolation[]>` — Evaluates file modifications against regex guardrail rules.

---

## Documentation Links

- [Architecture Guide](ARCHITECTURE.md)
- [User Guide](USER_GUIDE.md)
