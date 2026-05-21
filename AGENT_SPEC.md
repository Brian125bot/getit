# Specification & Source of Truth: Workspace Agent (`getit`)

This document is saved as a reference for the workspace.

## 1. Project Overview & Architectural Philosophy

`getit` is a lightweight, Man-in-the-Loop (MITL), terminal-native workspace assistant running inside a ChromeOS Linux container (Crostini Debian). It translates natural language intents into atomic system manipulations: discovering, downloading, installing, and updating software, as well as surgically editing system configuration files.

### Core Architectural Laws

1. **Isolated Execution Harness (Built from Scratch):** The execution loop is written completely from scratch in **TypeScript (Node.js)**. It acts as an absolute supervisor over the shell, rather than spawning a continuous, fragile `/bin/sh` process.
2. **Deterministic State Management:** Environment details (like the working directory) are handled statefully by the TypeScript runner. Absolute paths are enforced for all underlying file actions to prevent state loss across asynchronous turns.
3. **Strict Parameter Typing:** The agent communicates with the host machine exclusively through structured JSON schemas (Function/Tool Calling). Raw, unparsed string execution is completely banned to avoid shell injection exploits.

---

## 2. Security Framework & Sandboxing Principles

To mitigate risk from untrusted web payloads (such as malicious repositories or modified README files), the runtime implements three absolute security barriers:

```
┌────────────────────────────────────────────────────────┐
│               OpenRouter API Output (LLM)              │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│              TypeScript Tool Interceptor               │
│  - Blocks Banned Paths (~/.ssh, /etc)                  │
│  - Sanitizes Inputs & Disallows Shell Cascades         │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│               Environment Scrubber (Env)               │
│  - Strips API Keys (OPENROUTER_API_KEY)                │
│  - Drops Sensitive System Secrets                      │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│             Man-in-the-Loop Approval [Y/n/e]           │
└────────────────────────────────────────────────────────┘
```

### Secrets Containment

When triggering local shell executions via `child_process.execSync`, the runner must scrub all active runtime credentials to prevent exfiltration attacks:

```typescript
const safeEnv = { ...process.env };
delete safeEnv.OPENROUTER_API_KEY;
delete safeEnv.GITHUB_TOKEN;

// Execute with explicitly sterilized environment
execSync(command, { env: safeEnv, shell: '/bin/bash' });
```

### Safety Banned Vectors

* **Banned Directories:** Any tool interactions matching `~/.ssh/`, `/etc/`, `/boot/`, `/dev/`, or root-level user assets will fail silently or throw an immediate runtime error before reaching execution blocks.
* **Fail-Closed Pipelines:** If a command generates a non-zero exit code, the program instantly halts the turn. Automatic AI recovery attempts are completely blocked until the user manually authorizes a next step.

---

## 3. Four-Stage Development Strategy

### Stage 1: The MITL Interceptor Gate
Synchronized, visual interceptor gate halting tool executions until explicit manual terminal authorization is given.

### Stage 2: Ambient Environment Discovery
Automatically determine system hardware architecture and local paths on startup, passing them cleanly into the system prompt context.

### Stage 3: Transition to a Persistent REPL Shell
Maintain an interactive, stateful, multi-turn terminal loop that retains execution memory across commands without crashing or dropping shell context.

### Stage 4: Diff-Based Configuration Patching
Enforce non-destructive file configuration edits by calculating and displaying color-coded line diffs prior to file updates.
