# Architecture Guide — getit v2.0

> High-level system architecture, component interactions, security model, and data flow in getit v2.0.

---

## Architectural Principles

1. **Zero Production Dependencies:** Pure Node.js (≥ 20.0.0) implementation using native standard modules (`node:fs`, `node:child_process`, `node:crypto`, `node:readline`, `node:test`, `node:http`).
2. **Fail-Closed Security Model:** Unhandled errors, path policy violations, or unapproved MITL prompts halt execution immediately.
3. **Man-in-the-Loop (MITL) Gate:** All mutating operations (shell commands, file modifications, system changes) pass through human authorization before execution.
4. **Deterministic Secret Scrubbing:** Output streams and conversation histories pass through entropy-based and pattern-based redaction filters.
5. **Shadow Workspace Mirroring:** Tracked configuration files are mirrored in a shadow Git repository (`~/.local/state/getit/tracking/`) to enable drift detection and single-commit rollback.

---

## Component Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                          getit CLI & REPL                              │
│         (src/index.ts, src/repl/control-plane/*, src/ui/*)            │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
   ┌────────────────────┐ ┌──────────────────┐ ┌──────────────────┐
   │    Agent Loop      │ │  Watch Daemon    │ │  Sync & Vault    │
   │ (src/agent/loop)   │ │ (src/watcher/*)  │ │ (src/vault/*,    │
   └──────────┬─────────┘ └────────┬─────────┘ │  src/sync/*)     │
              │                    │           └──────────────────┘
              ▼                    ▼
   ┌─────────────────────────────────────────┐
   │            Tool Dispatcher              │
   │        (src/tools/registry.ts)          │
   └──────────────────┬──────────────────────┘
                      │
                      ▼
   ┌─────────────────────────────────────────┐
   │         MITL Approval Interceptor       │
   │        (src/mitl/interceptor.ts)        │
   └──────────────────┬──────────────────────┘
                      │
         ┌────────────┴────────────┐
         ▼                         ▼
┌──────────────────┐      ┌──────────────────┐
│  Execute Bash    │      │   Manage File    │
│(src/tools/exec)  │      │(src/tools/manage)│
└────────┬─────────┘      └────────┬─────────┘
         │                         │
         ▼                         ▼
┌────────────────────────────────────────────┐
│          Backup Ledger & Shadow            │
│         (src/backup/shadow-store.ts)       │
└────────────────────────────────────────────┘
```

---

## Module Breakdown

### 1. Control Plane & REPL (`src/repl/`, `src/ui/`)
- **Classifier:** Analyzes user input to route commands (slash commands vs. natural language prompts vs. recipe execution).
- **Palette & Hints:** In-memory fuzzy search for commands and contextual completion hints.
- **TerminalKit UI:** 2D rendering surface (`surface.ts`), ANSI color engine (`ansi.ts`), markup parser (`markup.ts`), and dashboard (`dashboard.ts`).

### 2. Core Agent (`src/agent/`)
- **`AgentLoop`:** Drives multi-turn iterations with the active carrier, handling streaming responses and recursive tool calls up to 10 iterations per turn.
- **`PromptBuilder`:** Injects system information, project tech stack memory, user preferences, and loaded plugin schemas into the system prompt.
- **`Client`:** Communicates with OpenRouter or OpenAI-compatible endpoints using Node.js native HTTP/HTTPS modules.

### 3. Tool & Plugin Registry (`src/tools/`, `src/plugins/`)
- **Central Dispatcher:** Receives tool invocation requests from LLM assistant responses.
- **Plugin Loader & Registry:** Discovers and dynamically loads plugin definitions from `.getit/tools/` and `~/.config/getit/tools/`. Validates parameters against JSON schema subsets.

### 4. MITL Gate & Security (`src/mitl/`, `src/security/`)
- **MITL Interceptor:** Formats approval cards in terminal and prompts user for authorization (`[Y/n/e/c]`).
- **Secret Scrubber:** Multi-tiered scrubbing combining Shannon entropy calculation (`H > 4.5`), regex patterns, and registered known secrets.
- **Path Policy:** Canonicalizes paths via `node:fs.realpathSync`, enforcing workspace boundaries and blocking traversal attacks.
- **Guardrail Engine:** Evaluates modifications against custom regex policy rules defined in `.getit/policy.json`.

### 5. Workspace & Backup (`src/workspace/`, `src/backup/`)
- **Manifest & Drift Engine:** Tracks file hashes, detects online/offline configuration drift, and suggests resolutions.
- **Shadow Store & Ledger:** Logs JSON transactions and saves file snapshots prior to modification to guarantee single-step or transaction-level undo.

---

## Execution Flow (Single Prompt Turn)

1. **User Prompt Input:** Input enters through REPL readline interface.
2. **Context Enrichment:** Session history, project tech stack memory, user preferences, and plugin schemas are assembled.
3. **LLM Request:** Request is dispatched to the active provider (e.g. OpenRouter).
4. **Tool Call Invocations:** If the LLM generates function call parameters, execution routes to `dispatchToolCall()`.
5. **Security & Path Validation:** Tool arguments are validated against path policies and guardrail rules.
6. **MITL Gate:** Approval card is rendered to stdout; execution halts pending user input (`Y`/`n`/`e`/`c`).
7. **Snapshot & Execution:** File state is snapshotted to the shadow store, and the command or file mutation runs.
8. **Scrubbing & Feedback:** Execution output is scrubbed for sensitive content and appended to the LLM context history.
