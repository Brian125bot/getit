# API Reference — getit v1.5.0

> Complete reference for all public exports, interfaces, and functions.

---

## Table of Contents

- [Agent Layer](#agent-layer)
- [Carriers](#carriers)
- [Security](#security)
- [Tools](#tools)
- [Execution](#execution)
- [MITL Gate](#mitl-gate)
- [Workspace](#workspace)
- [Backup & Undo](#backup--undo)
- [Planning](#planning)
- [Runtime](#runtime)
- [Discovery](#discovery)
- [UI](#ui)
- [Update](#update)

---

## Agent Layer

### `src/agent/loop.ts`

#### `class AgentLoop`

Orchestrates multi-turn LLM conversations with MITL tool-call interception.

```typescript
class AgentLoop {
  constructor(systemPrompt: string);

  // Returns the full message history (including system prompt)
  getMessages(): ChatMessage[];

  // Clears history and sets a new system prompt
  resetSession(systemPrompt: string): void;

  // Appends a message directly to history without triggering a turn
  addDirectMessage(role: 'user' | 'assistant' | 'system', content: string): void;

  // Executes one user turn: sends to LLM, dispatches tool calls, streams output
  // Max 10 tool-call iterations per turn (runaway guard)
  async runTurn(userInput: string): Promise<void>;
}
```

### `src/agent/client.ts`

#### `getActiveModel(): string`
Returns the currently active model identifier.

#### `setActiveModel(model: string): void`
Overrides the active model for subsequent requests.

#### `initSessionModel(model: string): void`
Sets the initial model for the session (called during startup).

#### `sendChatRequest(messages, tools, onToken): Promise<ChatCompletionResponse>`
Sends a chat completion request to the active carrier with streaming support.

| Parameter | Type | Description |
|---|---|---|
| `messages` | `ChatMessage[]` | Conversation history |
| `tools` | `object[]` | Tool schemas for function calling |
| `onToken` | `(token: string) => void` | Streaming callback for each token |

#### `setChatRequestMock(mock): void`
Replaces the real API call with a mock function (testing only).

### `src/agent/prompt.ts`

#### `buildSystemPrompt(): string`
Constructs the system prompt with environment context (architecture, platform, package manager, available tools, workspace state).

### `src/agent/tools.ts`

#### `const toolSchemas`
Array of OpenAI-compatible tool schemas exposed to the LLM:

```typescript
const toolSchemas = [
  {
    type: "function",
    function: {
      name: "execute_bash",
      description: "...",
      parameters: {
        command: { type: "string" },
        working_directory: { type: "string" }  // optional
      }
    }
  },
  {
    type: "function",
    function: {
      name: "manage_file",
      description: "...",
      parameters: {
        command: { type: "string", enum: ["create", "read", "patch"] },
        path: { type: "string" },
        content: { type: "string" },  // for create
        diff: { type: "string" }      // for patch
      }
    }
  }
];
```

---

## Carriers

### `src/carriers/registry.ts`

#### Types

```typescript
type CarrierId =
  | 'openrouter' | 'openai' | 'anthropic' | 'google' | 'groq'
  | 'deepseek' | 'together' | 'mistral' | 'azure' | 'ollama' | 'custom';

type CarrierAuth = 'bearer' | 'none' | 'api-key-header';

interface CarrierPreset {
  id: CarrierId;
  displayName: string;
  baseUrl: string;
  chatPath: string;
  modelsPath?: string;
  defaultModel: string;
  auth: CarrierAuth;
  envKeys: string[];
  supportsStreaming: boolean;
  supportsToolCalls: boolean;
}
```

#### `listCarrierPresets(): CarrierPreset[]`
Returns all 11 built-in carrier presets.

#### `getPreset(id: CarrierId): CarrierPreset`
Returns the preset for the given carrier ID. Throws if not found.

#### `normalizeCarrierId(raw?: string): CarrierId`
Normalizes a raw string to a valid `CarrierId`. Defaults to `'openrouter'` if unrecognized.

#### `resolveActivePreset(carrierId, baseUrl?): CarrierPreset`
Resolves the active carrier preset, applying any custom base URL overrides.

#### `requiresApiKey(preset: CarrierPreset): boolean`
Returns `true` if the preset's auth mode requires an API key.

#### `buildAzureBaseUrl(resource, deployment, apiVersion?): string`
Constructs an Azure OpenAI base URL from resource name and deployment.

#### `getAzureApiVersion(baseUrl: string): string`
Extracts the API version from an Azure OpenAI base URL.

### `src/carriers/transport.ts`

#### Types

```typescript
interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ChatCompletionResponse {
  content: string;
  tool_calls?: ToolCall[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

interface ChatCompletionOptions {
  messages: ChatMessage[];
  tools?: object[];
  model?: string;
  stream?: boolean;
  onToken?: (token: string) => void;
  timeout?: number;
}
```

#### `buildRequestHeaders(preset, apiKey?): Record<string, string>`
Constructs HTTP headers based on the carrier's auth mode.

#### `validateApiAccess(preset, apiKey?): void`
Throws if the carrier requires an API key and none is available.

#### `chatCompletions(options): Promise<ChatCompletionResponse>`
Sends a chat completion request to the active carrier. Handles streaming, tool call parsing, and error scrubbing.

#### `pingCarrier(preset, apiKey?): Promise<{ok: boolean; latencyMs: number; error?: string}>`
Health check — pings the carrier's models endpoint and returns latency.

### `src/carriers/models.ts`

#### `listModels(preset, apiKey?): Promise<string[]>`
Fetches available models from the carrier's models endpoint. Results are cached.

#### `clearModelCache(): void`
Clears the cached model list.

#### `formatModelList(models, max?): string`
Formats a model list for terminal display, truncated to `max` entries.

### `src/carriers/doctor.ts`

#### `runDoctorChecks(): Promise<DoctorCheck[]>`
Runs connectivity and configuration health checks:
- API key presence
- Carrier ping
- `git` CLI availability
- `gh` CLI availability

```typescript
interface DoctorCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
}
```

### `src/carriers/session.ts`

#### `switchCarrier(carrierId, overrides?): void`
Switches the active carrier for the current session. Resets model to the carrier's default.

#### `switchModel(model: string): void`
Overrides the model for the current session.

#### `getSessionApiKeyOverride(): string | undefined`
Returns any session-level API key override.

---

## Security

### `src/security/scrubber.ts`

#### `registerKnownSecret(secret: string): void`
Registers a known secret value for exact-match masking. Must be ≥8 characters.

#### `class MaskingSession`
Maintains a per-session mapping from raw secrets to deterministic placeholders (`[REDACTED_1]`, `[REDACTED_2]`, …).

```typescript
class MaskingSession {
  mask(value: string): string;    // Returns the placeholder for a secret
  hasMask(value: string): boolean; // Checks if a value is already masked
}
```

#### `getDefaultMaskingSession(): MaskingSession`
Returns the singleton default masking session.

#### `resetDefaultMaskingSession(): void`
Resets the default masking session (clears all mappings).

#### `shannonEntropy(value: string): number`
Computes the Shannon entropy of a string. Returns `0` for empty strings.

#### `scrubText(text, session?): string`
Applies all three scrubbing layers (known secrets, patterns, entropy) to the input text.

#### `class StreamScrubber`
Stateful scrubber for token-by-token streaming. Buffers partial tokens to prevent mid-secret splits.

```typescript
class StreamScrubber {
  constructor(session?: MaskingSession);

  push(chunk: string): string;  // Process a chunk, return safe output
  flush(): string;               // Flush remaining buffer
}
```

### `src/security/secrets-loader.ts`

#### `loadConfig(): CarrierConfig`
Loads carrier configuration from `.getitrc` / `~/.getitrc` / environment variables.

```typescript
interface CarrierConfig {
  carrier: CarrierId;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  timeout?: number;
}
```

#### `loadApiKey(): string | undefined`
Resolves the API key from the configuration chain (`.getitrc` → env vars).

#### `getActivePreset(): CarrierPreset`
Returns the fully resolved carrier preset with config overrides applied.

#### `getLoadedApiKey(): string | undefined`
Returns the cached API key from the last `loadApiKey()` call.

#### `configRequiresApiKey(config?): boolean`
Returns `true` if the current configuration requires an API key.

#### `getApiKeyEnvHints(carrierId?): string`
Returns a human-readable hint about which environment variables to set.

### `src/security/path-policy.ts`

#### `resolveRealPath(targetPath: string): Promise<string>`
Resolves a path to its absolute, real form (following symlinks, expanding `~`).

#### `validatePath(targetPath, options?): Promise<PathPolicyResult>`
Validates a path against the full policy stack (hardcoded bans, `.getitignore`, `policy.json`, workspace boundary).

```typescript
interface PathPolicyResult {
  allowed: boolean;
  resolvedPath: string;
  reason?: string;
}
```

#### `assertPathAllowed(targetPath, options?): Promise<string>`
Like `validatePath()` but throws on denial. Returns the resolved path on success.

### `src/security/policy.ts`

#### `loadPolicy(startDir: string): Promise<LoadedPolicy>`
Loads `.getitignore` patterns and `policy.json` rules starting from `startDir`.

```typescript
interface PolicyRule {
  pattern: string;
  action: 'deny' | 'allow';
}

interface LoadedPolicy {
  rules: PolicyRule[];
  ignorePatterns: string[];
}
```

#### `evaluatePolicy(targetPath, cwd, profile): Promise<{allowed: boolean; reason?: string}>`
Evaluates a path against all loaded policy rules and the active profile.

#### `globMatch(pattern, targetPath): boolean`
Tests if a target path matches a glob pattern.

### `src/security/input-sanitizer.ts`

#### `sanitizeBashCommand(command: string): SanitizationResult`
Scans a bash command for dangerous patterns.

```typescript
interface SanitizationResult {
  safe: boolean;
  warnings: string[];   // Human-readable warning messages
  command: string;       // Original command (unmodified)
}
```

Detects: shell cascades (`&&`, `||`, `;`), redirects (`>`, `>>`), subshells (`$(...)`, backticks), pipes to dangerous commands.

### `src/security/env-scrubber.ts`

#### `getSafeEnv(): NodeJS.ProcessEnv`
Returns a copy of `process.env` with all known sensitive keys removed. Used before spawning child processes.

---

## Tools

### `src/tools/registry.ts`

#### `dispatchToolCall(name, args): Promise<ToolDispatchResult>`
Routes a tool call to the appropriate handler and manages the MITL gate.

```typescript
interface ToolDispatchResult {
  content: string;          // Result message for LLM history
  haltTurn?: boolean;       // If true, stop the agent loop
  clarifyRequest?: string;  // If set, inject a clarification into history
}
```

#### `executePlannedCall(call: PlannedToolCall): Promise<ToolDispatchResult>`
Executes a single call from a dry-run plan queue.

### `src/tools/execute-bash.ts`

#### `executeBash(command, workingDirectory?): Promise<BashExecutionResult>`
Executes a bash command with full security pipeline and CWD tracking.

```typescript
interface BashExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  cwd: string;            // CWD after execution (may have changed via cd)
}
```

#### `getActiveCwd(): string`
Returns the current working directory for the execution context.

#### `setActiveCwd(newCwd: string): Promise<void>`
Sets the current working directory (validates the path exists).

#### `getDefaultTimeout(): number`
Returns the default command timeout in milliseconds.

#### `setDefaultTimeout(timeoutMs: number): void`
Sets the default command timeout.

### `src/tools/manage-file.ts`

#### `manageFile(command, path, content?, diff?): Promise<FileOperationResult>`
Handles file create, read, and patch operations with ledger snapshots and MITL approval.

```typescript
interface FileOperationResult {
  success: boolean;
  content: string;     // File content (read) or confirmation message (create/patch)
  path: string;        // Resolved absolute path
}
```

### `src/tools/diff.ts`

#### `generateDiffPreview(original, modified): string`
Generates a colored unified diff string using an LCS (Longest Common Subsequence) algorithm. Output includes ANSI color codes for terminal rendering.

---

## Execution

### `src/execution/async-process.ts`

#### `executeCommandAsync(command, options): Promise<AsyncProcessResult>`

```typescript
interface AsyncProcessOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;         // Milliseconds, default 30000
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

interface AsyncProcessResult extends LogBufferResult {
  exitCode: number;
  timedOut: boolean;
}
```

### `src/execution/log-buffer.ts`

#### `class LogBuffer`
Accumulates stdout/stderr output with token-aware truncation.

```typescript
class LogBuffer {
  append(chunk: string): void;
  getResult(): LogBufferResult;
}

interface LogBufferResult {
  stdout: string;
  stderr: string;
  truncated: boolean;
}
```

#### `approximateTokenCount(text: string): number`
Estimates token count as `Math.ceil(text.length / 4)`.

#### `truncateForContext(text, maxTokens?): string`
Truncates text to fit within a token limit, preserving head and tail.

---

## MITL Gate

### `src/mitl/interceptor.ts`

#### `interceptToolCall(context, payload, warnings?, editPayload?): Promise<InterceptionResult>`

```typescript
type InterceptionContext = 'BASH' | 'FILE CREATE' | 'FILE PATCH';

interface InterceptionResult {
  approved: boolean;          // true if user approved (Y or e)
  payload: string;            // Original or edited payload
  reason?: string;            // Denial reason (when n)
  clarifyRequest?: string;    // User's question (when c)
}
```

#### `setReadlineInterface(rl): void`
Injects a mock readline interface for testing.

#### `getReadlineInterface(): readline.Interface`
Returns the active readline interface (creates one if needed).

#### `closeReadlineInterface(): void`
Closes and destroys the readline interface.

---

## Workspace

### `src/workspace/manifest.ts`

#### Constants

```typescript
const MANIFEST_FILENAME = '.getit-manifest.json';
const CONFIG_CANDIDATES = ['.bashrc', '.zshrc', '.profile', '.bash_profile', /* ... */];
```

#### Types

```typescript
interface TrackedPathMetadata {
  relativePath: string;
  hash: string;            // SHA-256 of scrubbed content
  mode?: string;
  mtime?: string;
}

interface WorkspaceManifest {
  version: string;
  fingerprint: string;
  rootPath: string;
  tracked: TrackedPathMetadata[];
  createdAt: string;
  updatedAt: string;
}
```

#### `initWorkspaceManifest(rootPath): Promise<WorkspaceManifest>`
Initializes a new workspace manifest, discovering config candidates and computing initial hashes.

#### `loadWorkspaceManifest(rootPath): Promise<WorkspaceManifest>`
Loads an existing `.getit-manifest.json`.

#### `saveWorkspaceManifest(rootPath, manifest): Promise<void>`
Saves the manifest using atomic write.

#### `generateFingerprint(): string`
Generates a machine fingerprint string (architecture + hostname + platform).

#### `computeScrubbedHash(content: string): string`
Computes SHA-256 of scrubbed content for drift comparison.

### `src/workspace/drift.ts`

#### `detectWorkspaceDrift(workspaceRoot): Promise<DriftResult>`

```typescript
interface FileDriftStatus {
  path: string;
  status: 'unmodified' | 'modified' | 'missing' | 'untracked';
  manifestHash?: string;
  liveHash?: string;
}

interface DriftResult {
  files: FileDriftStatus[];
  summary: { unmodified: number; modified: number; missing: number; untracked: number };
}
```

### `src/workspace/drift-advisor.ts`

#### `getDriftAdvice(filePath, scrubbedContent, diffText): Promise<string>`
Uses the active LLM to generate human-readable advice for resolving a detected drift.

### `src/workspace/tracking.ts`

#### `getTrackingRoot(): Promise<string>`
Returns the path to the shadow tracking directory (`~/.local/state/getit/tracking/`).

#### `scrubContentGeneric(content: string): string`
Scrubs content using the default masking session before staging.

#### `stageToTracking(workspaceRoot, relativePath): Promise<void>`
Copies a file into the tracking repository after scrubbing.

#### `inspectTrackedFile(workspaceRoot, relativePath): Promise<string>`
Returns the scrubbed content of a tracked file.

### `src/workspace/history.ts`

#### `class WorkspaceHistoryManager`
Manages the shadow Git commit log.

```typescript
class WorkspaceHistoryManager {
  constructor(trackingRoot: string);

  // Returns the commit log (most recent first)
  async getHistory(limit?: number): Promise<CommitRecord[]>;

  // Renders the history as a formatted terminal string
  formatHistory(records: CommitRecord[]): string;
}

interface CommitRecord {
  hash: string;
  message: string;
  date: string;
  files: string[];
}
```

### `src/workspace/rollback.ts`

#### `isValidCommitHash(hash: string): boolean`
Validates that a string is a valid Git commit hash (7-40 hex chars).

#### `class WorkspaceRollbackManager`
Manages workspace rollback operations.

```typescript
class WorkspaceRollbackManager {
  constructor(workspaceRoot: string, trackingRoot: string);

  // Preview what would change
  async preview(commitHash: string): Promise<RollbackPreview>;

  // Apply the rollback (goes through MITL gate per file)
  async apply(commitHash: string): Promise<RollbackResult>;
}
```

### `src/workspace/export.ts`

#### `exportScrubbedWorkspace(workspaceRoot, outputDir?): Promise<ExportResult>`

```typescript
interface ExportResult {
  exportDir: string;
  filesExported: number;
  totalSize: number;
}
```

### `src/workspace/healer.ts`

#### `attemptDependencyHealing(stderr): Promise<{matched: boolean; command?: string; description?: string}>`
Scans stderr output against a rule engine of known failure patterns and returns a suggested fix command.

```typescript
interface HealingRule {
  pattern: RegExp;
  command: string;
  description: string;
}
```

### `src/workspace/boundary.ts`

#### `findWorkspaceRoot(startDir): Promise<string | null>`
Searches upward from `startDir` for workspace markers (`package.json`, `Cargo.toml`, etc.).

#### `isPathInWorkspace(targetPath, workspaceRoot): boolean`
Returns `true` if the path is contained within the workspace root.

### `src/workspace/profiles.ts`

#### Constants

```typescript
const COMMON_DIR = 'common';
const PROFILES_DIR = 'profiles';
```

#### `ensureProfileLayout(workspaceRoot, fingerprint): Promise<void>`
Creates the `common/` and `profiles/<fingerprint>/` directory structure.

#### `getProfileDir(workspaceRoot, fingerprint): string`
Returns the path to the machine-specific profile directory.

#### `collectProfileCandidatePaths(workspaceRoot, fingerprint): Promise<string[]>`
Lists all tracked file paths from both `common/` and the active profile.

#### `resolveLiveFilePath(workspaceRoot, relativePath): string`
Maps a manifest-relative path to its absolute live location.

### `src/workspace/fs-utils.ts`

#### `atomicWriteFile(filePath, content): Promise<void>`
Writes a file atomically using the UUID temp-file + rename pattern. Prevents partial-write corruption.

---

## Backup & Undo

### `src/backup/ledger.ts`

#### Types

```typescript
type LedgerOperation = 'file_create' | 'file_patch' | 'command';

interface LedgerTransaction {
  id: string;              // UUID
  promptId: string;        // Links to the user prompt that triggered this
  operations: Array<{
    type: LedgerOperation;
    path?: string;
    command?: string;
    timestamp: string;
  }>;
  timestamp: string;
}

interface LedgerFile {
  transactions: LedgerTransaction[];
}
```

#### `getBackupRoot(): string`
Returns `~/.local/state/getit/backup/`.

#### `getLedgerPath(): string`
Returns the path to the ledger JSON file.

#### `ensureBackupRoot(): Promise<void>`
Creates the backup directory structure if it doesn't exist.

#### `readLedger(): Promise<LedgerFile>`
Reads and parses the ledger file.

#### `appendOperation(transactionId, promptId, operation): Promise<void>`
Appends a new operation to the specified transaction.

#### `latestTransaction(): Promise<LedgerTransaction | undefined>`
Returns the most recent transaction from the ledger.

### `src/backup/shadow-store.ts`

#### `sha256(value): string`
Computes SHA-256 hex digest of a string or buffer.

#### `snapshotBeforeWrite(filePath, action): Promise<void>`
Saves a copy of the file's current content before any mutation.

#### `recordCommand(command, cwd, exitCode?): Promise<void>`
Records a command execution in the current transaction.

#### `undoLatestTransaction(options?): Promise<{success: boolean; message: string}>`
Restores all files to their pre-mutation state for the latest transaction.

#### `formatMixedWarning(ops): string`
Formats a warning message when a transaction contains both file and command operations (commands cannot be undone).

---

## Planning

### `src/planning/plan-queue.ts`

#### Types

```typescript
type PlannedToolName = 'execute_bash' | 'manage_file';

interface PlannedToolCall {
  tool: PlannedToolName;
  args: Record<string, any>;
  description?: string;
}
```

#### `class PlanQueue`
Manages a queue of planned tool calls for dry-run execution.

```typescript
class PlanQueue {
  enqueue(call: PlannedToolCall): void;
  dequeue(): PlannedToolCall | undefined;
  peek(): PlannedToolCall | undefined;
  isEmpty(): boolean;
  size(): number;
  toArray(): PlannedToolCall[];
  clear(): void;
}
```

#### `isMutatingToolCall(tool, args): boolean`
Returns `true` if the tool call would modify the system (write operations, non-read commands).

#### `renderRoadmap(queue: PlanQueue): string`
Renders the plan queue as a numbered Markdown roadmap for terminal display.

---

## Runtime

### `src/runtime/session.ts`

#### Types

```typescript
type PolicyProfile = 'strict' | 'normal' | 'override';

interface RuntimeSession {
  cwd: string;
  profile: PolicyProfile;
  maskingSession: MaskingSession;
  promptTransactionId: string;
  processActive: boolean;
  mitlActive: boolean;
  suppressMitl: boolean;
}
```

#### `createRuntimeSession(overrides?): RuntimeSession`
Creates a new runtime session with optional overrides.

#### `getRuntimeSession(): RuntimeSession`
Returns the current singleton runtime session.

#### `configureRuntimeSession(overrides): RuntimeSession`
Updates the current session with new values.

#### `startPromptTransaction(): RuntimeSession`
Generates a new transaction UUID for the current prompt turn.

---

## Discovery

### `src/discovery/environment.ts`

#### `discoverEnvironment(): EnvironmentContext`
Detects the current system environment.

```typescript
interface EnvironmentContext {
  arch: string;               // e.g., 'x86_64', 'arm64'
  platform: string;           // e.g., 'linux', 'darwin'
  distro?: string;            // e.g., 'Debian', 'Fedora', 'macOS'
  packageManager?: string;    // e.g., 'apt-get', 'brew', 'dnf'
  shell: string;              // e.g., '/bin/bash', '/bin/zsh'
  homeDir: string;
  localBinRegistered: boolean;
  availableTools: {
    curl: boolean;
    tar: boolean;
    unzip: boolean;
    git: boolean;
    gh: boolean;
  };
}
```

---

## UI

### `src/ui/layout.ts`

#### `getTerminalWidth(): number`
Returns the terminal width (defaults to 80 if not available).

#### `stripAnsi(text: string): string`
Removes ANSI escape codes from a string.

#### `centerLine(line, contentWidth, termWidth?): string`
Centers a single line of text.

#### `centerBlock(text, termWidth?): string`
Centers a multi-line block of text.

#### `centerPrompt(prompt, termWidth?): string`
Centers a prompt string for readline.

#### `getBoxChars(termWidth?, double?): BoxChars`
Returns box-drawing characters (single or double borders).

```typescript
interface BoxChars {
  tl: string;  // Top-left corner
  tr: string;  // Top-right corner
  bl: string;  // Bottom-left corner
  br: string;  // Bottom-right corner
  h: string;   // Horizontal line
  v: string;   // Vertical line
  ml: string;  // Middle-left junction
  mr: string;  // Middle-right junction
}
```

### `src/ui/spinner.ts`

#### `class TerminalSpinner`
Progress indicator for long-running operations.

```typescript
class TerminalSpinner {
  constructor(message: string);

  start(): void;                     // Begin animation
  succeed(message?: string): void;   // Show success state (✓)
  fail(message?: string): void;      // Show failure state (✗)
  stop(): void;                      // Stop without status
}
```

---

## Update

### `src/update.ts`

#### `getRepoRoot(): string`
Returns the root directory of the getit installation.

#### `checkForUpdates(): Promise<boolean>`
Checks npm registry for a newer version. Returns `true` if an update is available.

#### `performUpdate(): Promise<void>`
Executes `git pull` and `npm run build` to update the installation.

---

*This reference reflects getit v1.5.0. For architectural overview, see [ARCHITECTURE.md](ARCHITECTURE.md).*
