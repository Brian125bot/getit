# Architecture — getit v2.0.0

> Deep-dive technical reference for the internal architecture, data flow, and module interactions.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Layered Architecture](#2-layered-architecture)
3. [Module Reference](#3-module-reference)
4. [Data Flow](#4-data-flow)
5. [Security Pipeline](#5-security-pipeline)
6. [Workspace Subsystem](#6-workspace-subsystem)
7. [Carrier Framework](#7-carrier-framework)
8. [Execution Kernel](#8-execution-kernel)
9. [State Management](#9-state-management)
10. [Design Decisions](#10-design-decisions)

---

## 1. System Overview

`getit` is a terminal-native AI workspace agent that operates as a supervised execution pipeline. The system is organized into six distinct layers, each with a single responsibility:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         User Interface Layer                            │
│  REPL slash commands • CLI subcommands • Centered ANSI cards            │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      Agent Orchestration  (agent/)                      │
│  AgentLoop • buildSystemPrompt • sendChatRequest • toolSchemas          │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Tool Interceptor & Dispatch  (tools/)                │
│  registry • execute-bash • manage-file • diff preview                   │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      MITL Gate  (mitl/interceptor.ts)                   │
│  BASH | FILE CREATE | FILE PATCH  •  [Y/n/e/c]  •  edit-before-run     │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   Security Pipeline  (security/)                        │
│  path-policy • .getitignore • input-sanitizer • scrubber • env          │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   Execution Kernel  (execution/ + backup/)              │
│  async spawn • log truncation • ledger snapshots • undo                 │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   Workspace Subsystem  (workspace/)                     │
│  manifest • drift detection • healer • shadow tracking • rollback       │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Layered Architecture

### Layer 1: User Interface (`src/index.ts`, `src/ui/`)

The entry point handles:
- CLI argument parsing (`--setup`, `--dry-run`, `--model`, `--profile`, one-shot prompts)
- REPL initialization and slash command routing (`/carrier`, `/model`, `/status`, `/undo`, etc.)
- Terminal layout utilities: ANSI-aware centering, box drawing, progress spinners

**Key constraint:** The REPL uses `readline.createInterface()` from Node's native modules. The same readline instance is shared with the MITL interceptor to prevent stdin conflicts.

### Layer 2: Agent Orchestration (`src/agent/`)

The `AgentLoop` class manages multi-turn conversations:

```typescript
class AgentLoop {
  private messages: ChatMessage[];  // Full conversation history

  runTurn(userInput: string): Promise<void>;  // Execute one user turn
  resetSession(systemPrompt: string): void;   // Clear history
  pruneHistory(): void;                        // Keep ≤25 messages
}
```

**Turn lifecycle:**
1. User input is appended to `messages[]`
2. History is pruned to prevent context-window overflow (keeps last 20 messages + system prompt)
3. Messages are sent to the active carrier via `sendChatRequest()`
4. If the response contains `tool_calls`, each is dispatched through `dispatchToolCall()`
5. Tool results are appended to history; the loop continues until no more tool calls
6. A runaway guard halts execution after 10 tool-call iterations per turn

**Streaming:** Tokens stream through a `StreamScrubber` instance before reaching `process.stdout`, ensuring secrets are masked in real-time during model output.

### Layer 3: Tool Dispatch (`src/tools/`)

Two tool schemas are exposed to the LLM:

| Tool | Parameters | Purpose |
|---|---|---|
| `execute_bash` | `command: string`, `working_directory?: string` | Run a shell command |
| `manage_file` | `command: "create" \| "read" \| "patch"`, `path: string`, `content?: string`, `diff?: string` | File operations |

The `dispatchToolCall()` router:
1. Parses the tool name and arguments
2. Invokes the MITL interceptor for approval
3. On approval, executes the operation
4. Returns structured results (content, haltTurn flag, clarifyRequest)

### Layer 4: MITL Gate (`src/mitl/`)

The Man-in-the-Loop interceptor is the central safety mechanism:

```typescript
async function interceptToolCall(
  context: 'BASH' | 'FILE CREATE' | 'FILE PATCH',
  payload: string,
  warnings: string[],
  editPayload?: string
): Promise<InterceptionResult>;
```

**Rendering pipeline:**
1. The payload is scrubbed via `scrubText()` before display
2. An ANSI-bordered card is rendered with the context type and payload
3. Security warnings (if any) are displayed in red below the payload
4. The user is prompted with `[Y/n/e/c]`
5. Edit mode pre-fills the payload using `rl.write()` for inline modification

**Test bypass:** `GETIT_TEST_MODE=true` auto-approves all actions for automated testing.

### Layer 5: Security Pipeline (`src/security/`)

Five modules form the security pipeline:

#### 5a. Path Policy (`path-policy.ts`)
- Resolves all paths to absolute form (handles `~`, symlinks, relative paths)
- Checks against `.getitignore` patterns (hierarchical resolution from CWD to root)
- Enforces hardcoded bans: `~/.ssh`, `/etc`, `/boot`, `/dev`, `/`
- Respects the active security profile (`strict`, `normal`, `override`)

#### 5b. Global Policy (`policy.ts`)
- Loads `~/.config/getit/policy.json` (XDG_CONFIG_HOME-aware)
- Evaluates glob patterns against target paths
- Supports `deny` and `allow` actions

#### 5c. Input Sanitizer (`input-sanitizer.ts`)
- Detects shell cascades (`&&`, `||`, `;`)
- Flags I/O redirects (`>`, `>>`, `<`)
- Identifies subshell expansion (`$(...)`, backticks)
- Returns structured warnings for the MITL card

#### 5d. Secret Scrubber (`scrubber.ts`)
Three-layer scrubbing:
1. **Known-secret registry** — Exact match against startup-loaded API keys
2. **Pattern matching** — Regex for `sk-*`, `ghp_*`, `github_pat_*`, `AKIA*`, `Bearer *`, PEM blocks
3. **Shannon entropy analysis** — Heuristic for novel high-entropy strings

Entropy thresholds (tuned in v1.5 to reduce false positives):

| Threshold | Value | Applies To |
|---|---|---|
| `HEX_ENTROPY_THRESHOLD` | 4.5 | Pure hex strings (0-9a-f) |
| `BASE64_HARD_THRESHOLD` | 5.1 | Base64-like tokens (absolute ceiling) |
| `BASE64_SOFT_THRESHOLD` | 3.7 | Long base64 tokens (≥40 chars with mixed case + digits) |
| `GENERAL_ENTROPY_THRESHOLD` | 4.9 | Mixed-charset tokens (catch-all) |

`StreamScrubber` class provides stateful, chunk-aware scrubbing for real-time token streams.

#### 5e. Environment Scrubber (`env-scrubber.ts`)
```typescript
function getSafeEnv(): NodeJS.ProcessEnv;
```
Clones `process.env` and strips all known sensitive keys (`OPENROUTER_API_KEY`, `GITHUB_TOKEN`, etc.) before passing to `child_process.spawn()`.

### Layer 6: Execution Kernel (`src/execution/`, `src/backup/`)

#### Async Process Execution (`async-process.ts`)
- Spawns commands via `child_process.spawn()` with scrubbed environment
- Captures stdout/stderr with configurable timeout
- Streams output through `LogBuffer` for token-aware truncation

#### Log Buffer (`log-buffer.ts`)
- Approximates token count using a `chars / 4` heuristic
- Truncates output at 2,000 tokens to prevent context-window overflow
- Preserves both head and tail of long outputs

#### Ledger (`ledger.ts`)
- Transaction-based file mutation tracking
- Each transaction gets a UUID and records all file operations
- Supports `file_create`, `file_patch`, and `command` operation types

#### Shadow Store (`shadow-store.ts`)
- Pre-write snapshots: saves file content before any mutation
- SHA-256 hashing of original content for integrity verification
- `undoLatestTransaction()` restores files to pre-mutation state

---

## 3. Module Reference

### Module Dependency Graph

```
index.ts
├── agent/loop.ts
│   ├── agent/client.ts → carriers/transport.ts
│   ├── agent/prompt.ts → discovery/environment.ts
│   ├── agent/tools.ts
│   ├── tools/registry.ts
│   │   ├── tools/execute-bash.ts → execution/async-process.ts
│   │   ├── tools/manage-file.ts → backup/shadow-store.ts
│   │   └── tools/diff.ts
│   ├── mitl/interceptor.ts → security/scrubber.ts
│   └── security/scrubber.ts
├── security/secrets-loader.ts
│   └── carriers/registry.ts
├── setup/wizard.ts
├── workspace/manifest.ts
│   ├── workspace/boundary.ts
│   ├── workspace/drift.ts
│   ├── workspace/tracking.ts
│   ├── workspace/healer.ts
│   ├── workspace/history.ts
│   ├── workspace/rollback.ts
│   ├── workspace/export.ts
│   └── workspace/profiles.ts
└── ui/
    ├── layout.ts
    └── spinner.ts
```

---

## 4. Data Flow

### Turn Execution Flow

```
User Input ("install ripgrep")
    │
    ▼
AgentLoop.runTurn()
    │
    ├── pruneHistory()          ← Keep ≤25 messages
    ├── messages.push(user)     ← Append user message
    │
    ▼
sendChatRequest(messages, toolSchemas, streamCallback)
    │
    ├── resolveActivePreset()   ← Determine carrier + API key
    ├── chatCompletions()       ← HTTP POST to carrier endpoint
    │   ├── Token streaming     → StreamScrubber.push() → stdout
    │   └── Response parsing    → {content, tool_calls}
    │
    ▼
For each tool_call:
    │
    ├── dispatchToolCall(name, args)
    │   │
    │   ├── [execute_bash path]
    │   │   ├── sanitizeBashCommand()     ← Detect cascades, redirects
    │   │   ├── assertPathAllowed()       ← Path policy check
    │   │   ├── interceptToolCall(BASH)   ← MITL approval gate
    │   │   ├── executeBash()             ← Async spawn with safe env
    │   │   └── attemptDependencyHealing()← On non-zero exit
    │   │
    │   ├── [manage_file path]
    │   │   ├── assertPathAllowed()       ← Path policy check
    │   │   ├── snapshotBeforeWrite()     ← Ledger backup
    │   │   ├── interceptToolCall(FILE)   ← MITL approval gate
    │   │   └── atomicWriteFile()         ← UUID temp + rename
    │   │
    │   └── → ToolDispatchResult {content, haltTurn, clarifyRequest}
    │
    ├── messages.push(tool result)
    │
    └── Continue loop (or halt if haltTurn / max iterations)
```

### Workspace Drift Detection Flow

```
getit status
    │
    ▼
loadWorkspaceManifest()        ← Read .getit-manifest.json
    │
    ▼
For each tracked file:
    │
    ├── Read live file content
    ├── scrubContentGeneric()   ← Scrub before hashing
    ├── computeScrubbedHash()   ← SHA-256 of scrubbed content
    ├── Compare with manifest hash
    │
    └── → FileDriftStatus {path, status: 'unmodified'|'modified'|'missing'|'untracked'}
```

---

## 5. Security Pipeline

### Three-Layer Secret Scrubbing (Detail)

```
Input Text
    │
    ▼
Layer 1: Known-Secret Registry
    │  Exact string match against secrets registered at startup
    │  (API keys from .getitrc, OPENROUTER_API_KEY, GITHUB_TOKEN, etc.)
    │  Match → replace with [REDACTED_N] (deterministic placeholder)
    │
    ▼
Layer 2: Pattern Matching
    │  Regex patterns for well-known secret formats:
    │  • sk-[a-zA-Z0-9]{20,}          (OpenAI keys)
    │  • ghp_[a-zA-Z0-9]{36,}         (GitHub PATs)
    │  • github_pat_[a-zA-Z0-9_]{20,} (GitHub fine-grained PATs)
    │  • AKIA[0-9A-Z]{16}             (AWS access keys)
    │  • Bearer [a-zA-Z0-9\-._~+/]+=* (Bearer tokens)
    │  • -----BEGIN .* PRIVATE KEY----- (PEM blocks)
    │
    ▼
Layer 3: Shannon Entropy Analysis
    │  For each token ≥33 chars:
    │  1. Skip if it matches standard hash patterns (git SHAs)
    │  2. Skip if it looks like a URL (http://, https://)
    │  3. Classify charset: pure hex, base64-like, or general
    │  4. Apply the corresponding entropy threshold
    │  5. If entropy exceeds threshold → mask with [REDACTED_N]
    │
    ▼
Scrubbed Output
```

### MaskingSession

The `MaskingSession` class maintains a per-session mapping from raw secret values to stable placeholder tokens:

```
"sk-abc123..." → "[REDACTED_1]"
"ghp_xyz789..." → "[REDACTED_2]"
```

Deterministic placeholders ensure the same secret always maps to the same placeholder within a session, making scrubbed output consistent and readable.

---

## 6. Workspace Subsystem

### Manifest Lifecycle

```
getit manifest init
    │
    ├── findWorkspaceRoot()        ← Search for package.json, Cargo.toml, etc.
    ├── generateFingerprint()      ← Machine fingerprint (arch + hostname + platform)
    ├── ensureProfileLayout()      ← Create common/ and profiles/<fingerprint>/
    ├── Discover config candidates ← CONFIG_CANDIDATES list (.bashrc, .zshrc, etc.)
    ├── For each candidate:
    │   ├── Read file content
    │   ├── computeScrubbedHash()
    │   └── Record metadata (path, hash, mode, mtime)
    └── saveWorkspaceManifest()    ← Write .getit-manifest.json
```

### Shadow Tracking Repository

Located at `~/.local/state/getit/tracking/`, this is a Git-backed directory that mirrors tracked files in their scrubbed form:

- `stageToTracking()` copies a file through the scrubber before committing
- `inspectTrackedFile()` retrieves the scrubbed version for review
- The tracking repo never contains raw secrets

### Rollback System

The `WorkspaceRollbackManager` provides:
1. **Preview** — Show what would change before applying
2. **Path validation** — Ensure rollback targets are within workspace boundary
3. **Atomic restore** — Uses `atomicWriteFile()` (UUID temp + rename pattern)
4. **MITL gate** — Each file restoration goes through user approval

---

## 7. Carrier Framework

### Preset Architecture

Each carrier is defined as a `CarrierPreset`:

```typescript
interface CarrierPreset {
  id: CarrierId;
  displayName: string;
  baseUrl: string;
  chatPath: string;
  modelsPath?: string;
  defaultModel: string;
  auth: CarrierAuth;          // 'bearer' | 'none' | 'api-key-header'
  envKeys: string[];          // Environment variable names to check
  supportsStreaming: boolean;
  supportsToolCalls: boolean;
}
```

### Transport Layer

`chatCompletions()` handles:
- Request header construction based on carrier auth type
- Streaming via `Transfer-Encoding: chunked` (SSE parsing)
- Response content extraction and tool call parsing
- Error scrubbing (API error messages are scrubbed before display)
- Timeout handling (configurable per session)

### Runtime Switching

```bash
/carrier anthropic    # Switches preset, resets model to carrier default
/model claude-sonnet-4-20250514 # Overrides model within current carrier
```

State is managed in `src/carriers/session.ts` and persists for the REPL session.

---

## 8. Execution Kernel

### Async Process Lifecycle

```typescript
async function executeCommandAsync(
  command: string,
  options: AsyncProcessOptions
): Promise<AsyncProcessResult>;
```

1. Environment is scrubbed via `getSafeEnv()`
2. Command is spawned via `child_process.spawn('/bin/bash', ['-c', command])`
3. stdout and stderr are captured into a `LogBuffer`
4. On timeout, the process is killed with `SIGTERM`
5. Exit code is returned; non-zero triggers the healer pipeline

### Log Truncation

The `LogBuffer` prevents context-window overflow:
- Approximates token count as `Math.ceil(chars / 4)`
- Default threshold: 2,000 tokens
- Truncation preserves the first and last portions of output
- Uses `truncateForContext()` for the final message sent to the LLM

---

## 9. State Management

### RuntimeSession

A singleton `RuntimeSession` holds all mutable state for the current REPL session:

```typescript
interface RuntimeSession {
  cwd: string;                    // Current working directory
  profile: PolicyProfile;         // 'strict' | 'normal' | 'override'
  maskingSession: MaskingSession; // Secret placeholder mapping
  promptTransactionId: string;    // UUID for current user turn
  processActive: boolean;         // True when a child process is running
  mitlActive: boolean;            // True when awaiting MITL approval
  suppressMitl: boolean;          // Test mode flag
}
```

### Transaction Model

Each user prompt creates a new transaction via `startPromptTransaction()`. The transaction ID links all file mutations (ledger entries) and command executions within that turn, enabling atomic undo of an entire turn's changes.

---

## 10. Design Decisions

### Zero Dependencies

All functionality uses Node.js ≥20 native modules:
- `node:fs/promises` for file I/O
- `node:child_process` for command execution
- `node:crypto` for SHA-256 hashing
- `node:readline/promises` for interactive input
- `node:test` for the test suite
- `node:http` / `node:https` for API transport

This eliminates supply-chain risk and ensures the tool works on any Node 20+ installation.

### Structured Tool Calling Only

The LLM communicates exclusively through typed JSON schemas. Raw shell string execution is architecturally impossible — the `execute_bash` tool receives a single `command` string that is passed to `spawn('/bin/bash', ['-c', command])` after full policy and sanitization checks.

### Fail-Closed by Default

Every safety mechanism defaults to denial:
- Unknown paths are blocked
- Unparseable tool arguments halt the turn
- Non-zero exit codes stop the agent loop
- Missing API keys prevent carrier initialization

---

*This document reflects the architecture of getit v1.5.0. For the public API, see [API.md](API.md).*
