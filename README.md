<div align="center">

# getit ❯

**A Zero-Dependency, Man-in-the-Loop Terminal Workspace Agent**

[![Node.js ≥20](https://img.shields.io/badge/Node.js-%3E%3D20.0.0-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Zero Dependencies](https://img.shields.io/badge/production%20dependencies-0-brightgreen)](package.json)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS-lightgrey)](https://github.com/Brian125bot/getit)

*Translate natural language into safe, approved terminal actions — one atomic step at a time.*

[Quick Start](#4-installation--setup) · [Usage Guide](#5-usage) · [Security Model](#2-security-architecture) · [Configuration](#carrier--model-configuration) · [Test Suite](#6-test-suite)

---

</div>

## Overview

`getit` is a lightweight, stateful, terminal-native workspace assistant built entirely in TypeScript with **zero production dependencies**. It bridges natural language intent and real system operations — installing software, editing configuration files, and managing dotfiles — while keeping a human in complete control of every mutation.

Every command proposed by the LLM is intercepted, displayed, safety-checked, and held behind a manual `[Y/n/e]` approval gate before anything touches your system. No action ever executes automatically.

---

## Feature Highlights

| Feature | Description |
|---|---|
| 🧠 **Multi-carrier LLM Support** | OpenRouter, OpenAI, Anthropic, Google Gemini, Groq, DeepSeek, Mistral, Azure, Together AI, Ollama, and any OpenAI-compatible endpoint |
| 🔐 **Man-in-the-Loop Gate** | Every bash command and file mutation requires explicit `[Y/n/e]` approval |
| 🧹 **Shannon Entropy Scrubbing** | High-entropy secrets are masked before they reach the LLM or the terminal |
| 📁 **Policy Engine** | `.getitignore` and `policy.json` block dangerous paths at multiple resolution layers |
| ↩️ **Ledger-Backed Undo** | File mutations are snapshotted before writes; `getit undo` restores the previous state |
| 🗺️ **Dry-Run Planner** | Preview the full multi-step action plan before a single command executes |
| 📊 **Workspace Drift Detection** | SHA-256 tracking of dotfiles detects live vs. manifest divergence |
| 🩹 **Deterministic Healer** | Rule-based dependency error detection proposes targeted fixes without involving the LLM |
| ⚙️ **Setup Wizard** | Interactive `--setup` wizard writes `.getitrc` with carrier, model, and timeout |

---

## 1. Design Philosophy

`getit` is built on three non-negotiable architectural laws:

1. **Isolated Execution Harness** — The tool interceptor is written from scratch. It acts as an absolute supervisor over the shell. No unstructured subshell is ever spawned by the model.
2. **Deterministic State Management** — Working directories and all file paths are maintained statefully in TypeScript. Absolute path resolution is enforced before every read, write, or policy check.
3. **Strict Parameter Typing** — The LLM communicates exclusively through structured JSON tool schemas (`execute_bash`, `manage_file`). Raw, unparsed shell string execution is architecturally impossible.

---

## 2. Security Architecture

Every proposed action passes through three sequential safety layers before reaching execution:

```
┌────────────────────────────────────────────────────────┐
│               LLM Output (Tool Call JSON)              │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│            TypeScript Tool Interceptor                 │
│  • Policy Engine  (.getitignore / policy.json)         │
│  • Banned Paths   (~/.ssh, /etc, /boot, /dev, /)       │
│  • Input Sanitizer (cascades, redirects, subshells)    │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│            Environment Scrubber                        │
│  • Shannon Entropy Masking  (threshold: 4.5 / 5.1)     │
│  • Regex Credential Patterns (API keys, tokens, certs) │
│  • Deterministic Placeholder Substitution              │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│            Man-in-the-Loop Gate  [Y/n/e]               │
│  • Colored ANSI diff card for file patches             │
│  • Safety warnings for detected dangerous patterns     │
│  • `e` option: interactively edit before executing     │
└────────────────────────────────────────────────────────┘
```

### Security Guarantees

- **Fail-Closed Execution** — A non-zero exit code instantly halts the agent turn. No automatic AI retry is possible without a new explicit user prompt.
- **Absolute Path Enforcement** — All file operations resolve `~`, symlinks, and relative paths before any policy check.
- **Secrets-Free Tracking** — Scrubbing runs before anything enters the shadow tracking repository, rollback previews, drift hashes, or model history.
- **No Raw Credentials in Child Processes** — API keys and tokens are stripped from the environment before any `spawn` call.

---

## 3. System Architecture

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
│  BASH | FILE CREATE | FILE PATCH  •  [Y/n/e]  •  edit-before-run        │
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
│  manifest • drift detection • healer • shadow tracking                  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Installation & Setup

### Prerequisites

- **Node.js** ≥ 20.0.0
- **npm** ≥ 10.0.0

### Steps

**1. Clone and enter the project:**
```bash
git clone https://github.com/Brian125bot/getit.git
cd getit
```

**2. Install dev dependencies** *(zero production dependencies)*:
```bash
npm install
```

**3. Build:**
```bash
npm run build
```

**4. Register the `getit` command** *(choose one)*:

```bash
# Option A — User-space symlink (recommended)
mkdir -p ~/.local/bin
ln -sf $(pwd)/dist/index.js ~/.local/bin/getit
chmod +x ~/.local/bin/getit

# Option B — npm global link
npm link
```

**5. Run the interactive setup wizard:**
```bash
getit --setup
```

Or configure manually by creating `.getitrc` or `~/.getitrc`:
```ini
GETIT_CARRIER=openrouter
GETIT_API_KEY=your-api-key
GETIT_MODEL=nvidia/nemotron-3-super-120b-a12b:free
```

### Carrier & Model Configuration

`getit` supports eleven LLM carriers out of the box. The first matching environment variable wins.

| Carrier ID | Provider | Key Environment Variables |
|---|---|---|
| `openrouter` | OpenRouter | `OPENROUTER_API_KEY`, `GETIT_API_KEY` |
| `openai` | OpenAI | `OPENAI_API_KEY`, `GETIT_API_KEY` |
| `anthropic` | Anthropic | `ANTHROPIC_API_KEY`, `GETIT_API_KEY` |
| `google` | Google Gemini | `GOOGLE_API_KEY`, `GEMINI_API_KEY` |
| `groq` | Groq | `GROQ_API_KEY`, `GETIT_API_KEY` |
| `deepseek` | DeepSeek | `DEEPSEEK_API_KEY`, `GETIT_API_KEY` |
| `together` | Together AI | `TOGETHER_API_KEY`, `GETIT_API_KEY` |
| `mistral` | Mistral | `MISTRAL_API_KEY`, `GETIT_API_KEY` |
| `azure` | Azure OpenAI | `AZURE_OPENAI_API_KEY`, `GETIT_API_KEY` |
| `ollama` | Ollama (local) | *(no key required)* |
| `custom` | Any OpenAI-compatible URL | `GETIT_API_KEY` *(optional)* |

---

## 5. Usage

### Starting the Agent

```bash
getit
```

On launch, the dashboard displays live environment context:

```
┌────────────────────────────────────────────────────────┐
│ GETIT WORKSPACE AGENT v1.0.0                           │
├────────────────────────────────────────────────────────┤
│ Architecture:  x86_64                                  │
│ Platform:      Linux (Debian)                          │
│ Package Mgr:   apt-get                                 │
│ Dependencies:  curl:✓  tar:✓  unzip:✓                  │
│ ~/.local/bin:  Registered ✓                            │
│ Workspace:     Initialized ✓                           │
└────────────────────────────────────────────────────────┘
Type exit or press Ctrl+C to terminate the session.

getit-agent ❯ _
```

### Core CLI Commands

```bash
# Start the interactive REPL
getit

# Run a one-shot command
getit "install ripgrep and add it to my PATH"

# Preview a full multi-step plan before execution
getit --dry-run "set up a Node.js dev environment"

# Restore the last modified file batch
getit undo

# Select a security profile for the session
getit --profile strict
```

### Setup & Diagnostics

```bash
getit --setup            # Interactive wizard (all carriers)
getit config             # Show active carrier, model, and timeout
getit doctor             # Health check: API ping, git, gh CLI
getit models             # List all models for the active carrier
getit --model gpt-4o     # Override the model for one session
```

### Workspace Management

```bash
getit manifest init      # Initialize workspace manifest and profile dirs
getit status             # Offline drift report (live vs. manifest)
getit inspect .bashrc    # View the scrubbed tracking mirror of a file
getit export [dir]       # Bulk export all scrubbed tracked files
getit resolve            # Interactively resolve drift with AI advisory
getit history            # Browse shadow Git commit history
getit rollback <hash>    # Roll back live files to a shadow commit (MITL)
```

### REPL Slash Commands

Inside the interactive REPL, the following slash commands are handled locally without sending to the LLM:

| Command | Action |
|---|---|
| `/carrier <id>` | Switch LLM carrier for this session |
| `/models` | List models for the active carrier |
| `/model <id>` | Switch model for this session |
| `/config` | Print current configuration |
| `/setup` | Re-run the setup wizard |
| `/status` | Show workspace drift summary |
| `/resolve` | Start interactive drift resolution |
| `/export` | Export all scrubbed tracked files |
| `/history` | View shadow commit log |
| `/rollback <hash>` | Roll back to a shadow commit |
| `/undo` | Restore the last file snapshot batch |
| `/dry-run <prompt>` | Generate a plan without executing |
| `/policy` | Show active policy rules |

---

## 6. How It Works

### MITL Approval Gate

Every proposed action renders a bordered ANSI card before execution:

```
╔══════════════════════════════════════════════════════════╗
║  BASH                                                    ║
║  apt-get install -y ripgrep                              ║
╠══════════════════════════════════════════════════════════╣
║  ⚠  No safety warnings detected.                        ║
╚══════════════════════════════════════════════════════════╝

Approve? [Y/n/e] _
```

- `Y` / `Enter` — Execute in the safe, scrubbed environment
- `n` — Deny; the denial is passed back to model history
- `e` — Open the payload in an inline editor before running

For file patches, a colored unified diff is rendered above the card:

```diff
- export PATH="$HOME/.cargo/bin:$PATH"
+ export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
```

### Dry-Run Planner

The `--dry-run` flag instructs the model to compile a full action manifest *before* touching anything:

```bash
getit --dry-run "install Go 1.22 and set GOPATH"
```

The agent generates a step-by-step Markdown roadmap. Approving the roadmap batch-authorizes each step sequentially, with individual MITL prompts still displayed for each mutation.

### Workspace Drift Detection

After `getit manifest init`, `getit` tracks your dotfiles and configuration files using SHA-256 hashes of scrubbed content. Run `getit status` at any time to see:

- ✅ `Tracked & Unmodified`
- ⚠️ `Modified` — live file diverges from the manifest hash
- ❓ `Untracked` — present on disk, absent from manifest
- ❌ `Missing` — recorded in manifest, absent from disk

### Deterministic Dependency Healer

When a command exits with a non-zero status code, the healer scans `stderr` against a rule engine of known failure patterns. A matched rule produces a deterministic fix command (e.g., `apt-get install -y libssl-dev`) that is sent directly to the MITL gate — **no LLM inference involved**. The healer never auto-executes.

---

## 7. Policy & Path Control

### `.getitignore`

Place a `.getitignore` file in your project root or any parent directory to block `getit` from touching specific paths:

```gitignore
# Protect all private key files
*.pem
*.key
/secrets/*

# Block .env files from being read or patched
.env*
```

Patterns are resolved hierarchically from `$PWD` up to the filesystem root, then merged with global rules.

### Global Policy (`~/.config/getit/policy.json`)

Define machine-wide rules and execution profiles:

```json
{
  "profile": "normal",
  "rules": [
    { "pattern": "~/.ssh/*", "action": "deny" },
    { "pattern": "/etc/**", "action": "deny" }
  ]
}
```

**Execution Profiles:**

| Profile | Behavior |
|---|---|
| `strict` | Blocks all default system targets, hidden configs, and all `.getitignore` patterns |
| `normal` *(default)* | Enforces base policy; allows local credential updates with MITL confirmation |
| `override` | Restricted to explicit user-specified allowlist only |

---

## 8. Test Suite

`getit` includes a comprehensive test suite (112 tests) using Node's native test runner:

```bash
npm test
```

### Test Coverage

| Suite | File | Description |
|---|---|---|
| **Functionality** | `tests/functionality.test.ts` | Architecture mapping, env parsing, LCS diff, path resolution, file metrics |
| **Safety & Security** | `tests/safety.test.ts` | Path traversal blocking, secrets scrubbing, cascade/redirect/subshell detection |
| **Stage Verification** | `tests/stage*.test.ts` | MITL rejection, env injection, REPL persistence, colored diffs |
| **Phase 2 — Async** | `tests/phase2-async.test.ts` | Streaming output, log truncation at 2,000-token threshold |
| **Phase 2 — Backup** | `tests/phase2-backup.test.ts` | Shadow snapshots, undo restoration, mid-write failure recovery |
| **Phase 2 — Policy** | `tests/phase2-policy.test.ts` | `.getitignore` pattern matching, nested resolution, symlink traversal blocking |
| **Phase 2 — Security** | `tests/phase2-scrub.test.ts` | Shannon entropy masking, false-positive prevention |
| **Phase 2 — Platform** | `tests/phase2-platform.test.ts` | macOS/Debian/Fedora/Arch package manager detection |
| **Phase 2 — Planner** | `tests/phase2-plan.test.ts` | Dry-run manifest generation, rejection exit behavior |
| **Phase 3 — Workspace** | `tests/phase3-manifest.test.ts` | Manifest init, boundary enforcement, metadata-only serialization |
| **Phase 3 — Drift** | `tests/phase3-drift.test.ts` | Hash comparison, `Modified` / `Missing` status, scrubbed tracking mirror |
| **Phase 3 — Healer** | `tests/phase3-healer.test.ts` | Known error routing to MITL, no auto-execution |
| **Phase 3 — Remote** | `tests/phase3-remote.test.ts` | Pre-push secret scan abort, fail-closed network handling |
| **Carriers** | `tests/carriers-*.test.ts` | Registry presets, auth modes, transport headers, config loading per provider |

---

## 9. Project Structure

```
getit/
├── src/
│   ├── index.ts            # Entry point, CLI argument parsing, REPL loop
│   ├── agent/              # Agent loop, system prompt builder, LLM client
│   ├── carriers/           # Multi-carrier adapter framework (11 providers)
│   ├── discovery/          # Environment fingerprinting, platform detection
│   ├── execution/          # Async spawn kernel, log truncation, stream pipeline
│   ├── mitl/               # Interceptor gate, ANSI card renderer, edit mode
│   ├── planning/           # Dry-run compiler, roadmap manifest generation
│   ├── runtime/            # REPL state, turn management, slash command router
│   ├── security/           # Path policy, scrubber, input sanitizer, env cleaner
│   ├── setup/              # Interactive setup wizard, .getitrc writer
│   ├── tools/              # Tool registry, execute-bash, manage-file, diff engine
│   ├── ui/                 # Centered ANSI layout, progress indicators
│   ├── workspace/          # Manifest, drift detection, healer, tracking
│   └── backup/             # Ledger, snapshot store, undo engine
├── tests/                  # 112-test native Node.js test suite
├── dist/                   # Compiled JavaScript output
├── package.json
└── tsconfig.json
```

---

## 10. Contributing

Contributions are welcome. Please open an issue before submitting a pull request for significant changes. Ensure all 112 tests pass before opening a PR:

```bash
npm test
```

Please maintain the **zero production dependencies** constraint. All features must use Node.js ≥20 native modules only.

---

## 11. License

[ISC](LICENSE)

---

## Contact

📬 **redstarapps@proton.me**

---

<div align="center">

*Built with zero dependencies. Every action, your approval.*

</div>
