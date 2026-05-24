<div align="center">

# getit ❯

**A Zero-Dependency, Man-in-the-Loop Terminal Workspace Agent**

[![Version 1.5.0](https://img.shields.io/badge/version-1.5.0-blue?style=flat-square)](CHANGELOG.md)
[![Node.js ≥20](https://img.shields.io/badge/Node.js-%3E%3D20.0.0-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Zero Dependencies](https://img.shields.io/badge/production%20dependencies-0-brightgreen)](package.json)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS-lightgrey)](https://github.com/Brian125bot/getit)
[![Tests](https://img.shields.io/badge/tests-112%20passing-success?style=flat-square)](tests/)

*Translate natural language into safe, approved terminal actions — one atomic step at a time.*

[Quick Start](#quick-start) · [How It Works](#how-it-works) · [Commands](#commands) · [Security](#security-architecture) · [Configuration](#carrier--model-configuration) · [Architecture](ARCHITECTURE.md) · [API Reference](API.md) · [Contributing](CONTRIBUTING.md)

---

</div>

## What is getit?

`getit` is a lightweight, stateful, terminal-native workspace assistant built entirely in TypeScript with **zero production dependencies**. It bridges natural language intent and real system operations — installing software, editing configuration files, managing dotfiles, and tracking workspace drift — while keeping a human in complete control of every mutation.

**Every command proposed by the LLM is intercepted, displayed, safety-checked, and held behind a manual `[Y/n/e/c]` approval gate before anything touches your system.** No action ever executes automatically.

### Why getit?

| Problem | getit's Solution |
|---|---|
| AI agents that silently execute dangerous commands | Every action requires explicit `[Y/n/e/c]` approval |
| API keys leaking into LLM context or terminal output | Shannon entropy scrubbing + pattern matching + known-secret registry |
| Heavyweight agent frameworks with dozens of dependencies | Zero production dependencies — just Node.js ≥20 |
| Vendor lock-in to a single LLM provider | 11 carriers supported out of the box |
| No way to undo AI-driven file changes | Ledger-backed snapshots with `getit undo` |
| Configuration drift going undetected | SHA-256 manifest tracking with offline drift detection |

---

## Feature Highlights

| Feature | Description |
|---|---|
| 🧠 **Multi-Carrier LLM Support** | OpenRouter, OpenAI, Anthropic, Google Gemini, Groq, DeepSeek, Mistral, Azure, Together AI, Ollama, and any OpenAI-compatible endpoint |
| 🔐 **Man-in-the-Loop Gate** | Every bash command and file mutation requires explicit `[Y/n/e/c]` approval |
| 🧹 **Shannon Entropy Scrubbing** | High-entropy secrets are masked before they reach the LLM or the terminal |
| 📁 **Policy Engine** | `.getitignore` and `policy.json` block dangerous paths at multiple resolution layers |
| ↩️ **Ledger-Backed Undo** | File mutations are snapshotted before writes; `getit undo` restores the previous state |
| 🗺️ **Dry-Run Planner** | Preview the full multi-step action plan before a single command executes |
| 📊 **Workspace Drift Detection** | SHA-256 tracking of dotfiles detects live vs. manifest divergence |
| 🩹 **Deterministic Healer** | Rule-based dependency error detection proposes targeted fixes without involving the LLM |
| ⚙️ **Setup Wizard** | Interactive `--setup` wizard writes `.getitrc` with carrier, model, and timeout |
| 🔄 **Self-Update** | Built-in `getit update` command for seamless version upgrades |

---

## Quick Start

### Prerequisites

- **Node.js** ≥ 20.0.0
- **npm** ≥ 10.0.0

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/Brian125bot/getit.git
cd getit

# 2. Install dev dependencies (zero production dependencies)
npm install

# 3. Build the TypeScript source
npm run build

# 4. Register the `getit` command (choose one)

# Option A — User-space symlink (recommended)
mkdir -p ~/.local/bin
ln -sf $(pwd)/dist/index.js ~/.local/bin/getit
chmod +x ~/.local/bin/getit

# Option B — npm global link
npm link

# 5. Run the interactive setup wizard
getit --setup
```

### First Run

```bash
# Start the interactive REPL
getit

# Or run a one-shot command
getit "install ripgrep and add it to my PATH"
```

On launch, the dashboard displays live environment context:

```
┌────────────────────────────────────────────────────────┐
│ GETIT WORKSPACE AGENT v1.5.0                           │
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

### Manual Configuration

Instead of the wizard, you can create `.getitrc` (project-local) or `~/.getitrc` (global):

```ini
GETIT_CARRIER=openrouter
GETIT_API_KEY=your-api-key
GETIT_MODEL=nvidia/nemotron-3-super-120b-a12b:free
GETIT_TIMEOUT=30000
```

---

## How It Works

### The MITL Approval Gate

Every proposed action renders a bordered ANSI card before execution:

```
╔══════════════════════════════════════════════════════════╗
║  BASH                                                    ║
║  apt-get install -y ripgrep                              ║
╠══════════════════════════════════════════════════════════╣
║  ⚠  No safety warnings detected.                        ║
╚══════════════════════════════════════════════════════════╝

Approve? [Y/n/e/c] _
```

| Key | Action |
|---|---|
| `Y` / Enter | Execute the action as proposed |
| `n` | Deny — rejection is passed back to the model as context |
| `e` | Edit — the payload is pre-filled into your readline prompt for modification |
| `c` | Clarify — pause execution and ask the agent a follow-up question inline |

For file patches, a colored unified diff is rendered above the card:

```diff
- export PATH="$HOME/.cargo/bin:$PATH"
+ export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
```

### Dry-Run Planner

Preview a full multi-step plan *before* touching anything:

```bash
getit --dry-run "set up a Node.js dev environment"
```

The agent generates a step-by-step Markdown roadmap. Approving the roadmap batch-authorizes each step sequentially, with individual MITL prompts still displayed for each mutation.

### Workspace Drift Detection

After initializing a workspace manifest, `getit` tracks your dotfiles and configuration files using SHA-256 hashes of scrubbed content:

```bash
getit manifest init    # Initialize tracking
getit status           # Check for drift
```

Files are categorized as:

| Status | Meaning |
|---|---|
| ✅ Tracked & Unmodified | Live file matches the manifest hash |
| ⚠️ Modified | Live file has diverged from the manifest |
| ❓ Untracked | Present on disk but absent from manifest |
| ❌ Missing | Recorded in manifest but absent from disk |

### Deterministic Dependency Healer

When a command fails, the healer scans `stderr` against a rule engine of known failure patterns. A matched rule produces a deterministic fix command (e.g., `apt-get install -y libssl-dev`) that is sent directly to the MITL gate — **no LLM inference involved**. The healer never auto-executes.

---

## Commands

### CLI Commands

```bash
getit                              # Start the interactive REPL
getit "install ripgrep"            # One-shot command execution
getit --dry-run "set up Go 1.22"   # Preview plan before execution
getit --setup                      # Interactive configuration wizard
getit --model gpt-4o               # Override model for one session
getit --profile strict             # Select a security profile
getit undo                         # Restore the last modified file batch
getit config                       # Show active carrier, model, and timeout
getit doctor                       # Health check: API ping, git, gh CLI
getit models                       # List all models for the active carrier
getit update                       # Self-update from npm
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

Inside the interactive REPL, the following commands are handled locally without sending to the LLM:

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
| `/help` | Show available commands |
| `/clear` | Clear the conversation |

---

## Carrier & Model Configuration

`getit` supports eleven LLM carriers out of the box. The first matching environment variable wins.

| Carrier ID | Provider | Key Environment Variables | Default Model |
|---|---|---|---|
| `openrouter` | OpenRouter | `OPENROUTER_API_KEY`, `GETIT_API_KEY` | `nvidia/nemotron-3-super-120b-a12b:free` |
| `openai` | OpenAI | `OPENAI_API_KEY`, `GETIT_API_KEY` | `gpt-4o` |
| `anthropic` | Anthropic | `ANTHROPIC_API_KEY`, `GETIT_API_KEY` | `claude-sonnet-4-20250514` |
| `google` | Google Gemini | `GOOGLE_API_KEY`, `GEMINI_API_KEY` | `gemini-pro` |
| `groq` | Groq | `GROQ_API_KEY`, `GETIT_API_KEY` | `llama-3.3-70b-versatile` |
| `deepseek` | DeepSeek | `DEEPSEEK_API_KEY`, `GETIT_API_KEY` | `deepseek-chat` |
| `together` | Together AI | `TOGETHER_API_KEY`, `GETIT_API_KEY` | `meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo` |
| `mistral` | Mistral | `MISTRAL_API_KEY`, `GETIT_API_KEY` | `mistral-large-latest` |
| `azure` | Azure OpenAI | `AZURE_OPENAI_API_KEY`, `GETIT_API_KEY` | *(deployment-specific)* |
| `ollama` | Ollama (local) | *(no key required)* | `llama3` |
| `custom` | Any OpenAI-compatible URL | `GETIT_API_KEY` *(optional)* | *(user-specified)* |

### Switching Carriers at Runtime

```bash
# From the REPL
/carrier openai
/model gpt-4o

# Or from CLI
getit --model gpt-4o "explain this error"
```

---

## Security Architecture

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
│  • Shannon Entropy Masking  (HEX: 4.5, B64: 5.1)      │
│  • Regex Credential Patterns (API keys, tokens, certs) │
│  • Known-Secret Registry (exact match, startup-loaded) │
│  • Deterministic Placeholder Substitution              │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│            Man-in-the-Loop Gate  [Y/n/e/c]             │
│  • Colored ANSI diff card for file patches             │
│  • Safety warnings for detected dangerous patterns     │
│  • `e` option: interactively edit before executing     │
│  • `c` option: pause and ask the agent a question      │
└────────────────────────────────────────────────────────┘
```

### Security Guarantees

| Guarantee | Implementation |
|---|---|
| **Fail-Closed Execution** | Non-zero exit code instantly halts the agent turn. No automatic AI retry. |
| **Absolute Path Enforcement** | All file operations resolve `~`, symlinks, and relative paths before policy checks. |
| **Secrets-Free Tracking** | Scrubbing runs before anything enters the shadow tracking repo, rollback previews, drift hashes, or model history. |
| **No Raw Credentials in Child Processes** | API keys and tokens are stripped from the environment before any `spawn` call via `getSafeEnv()`. |
| **Runaway Guard** | Maximum 10 tool-call iterations per agent turn prevents infinite loops. |
| **Input Sanitization** | Shell cascades (`&&`, `||`), redirects (`>`), and subshell expansion (`$(...)`) are detected and flagged. |

For full security documentation, see [SECURITY.md](SECURITY.md).

---

## Policy & Path Control

### `.getitignore`

Place a `.getitignore` file in your project root or any parent directory:

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

```json
{
  "profile": "normal",
  "rules": [
    { "pattern": "~/.ssh/*", "action": "deny" },
    { "pattern": "/etc/**", "action": "deny" }
  ]
}
```

### Execution Profiles

| Profile | Behavior |
|---|---|
| `strict` | Blocks all default system targets, hidden configs, and all `.getitignore` patterns |
| `normal` *(default)* | Enforces base policy; allows local credential updates with MITL confirmation |
| `override` | Restricted to explicit user-specified allowlist only |

---

## Test Suite

`getit` includes a comprehensive test suite (112 tests) using Node's native test runner:

```bash
npm test
```

### Test Coverage

| Suite | File | Tests | Description |
|---|---|---|---|
| **Functionality** | `functionality.test.ts` | Core | Architecture mapping, env parsing, LCS diff, path resolution, file metrics |
| **Safety & Security** | `safety.test.ts` | Core | Path traversal blocking, secrets scrubbing, cascade/redirect/subshell detection |
| **Stage Verification** | `stage*.test.ts` | 4 files | MITL rejection, env injection, REPL persistence, colored diffs |
| **Async Execution** | `phase2-async.test.ts` | Streaming | Streaming output, log truncation at 2,000-token threshold |
| **Backup & Undo** | `phase2-backup.test.ts` | Data | Shadow snapshots, undo restoration, mid-write failure recovery |
| **Policy Engine** | `phase2-policy.test.ts` | Security | `.getitignore` pattern matching, nested resolution, symlink traversal blocking |
| **Secret Scrubbing** | `phase2-scrub.test.ts` | 19 tests | Shannon entropy masking, false-positive prevention, stream scrubber |
| **Platform Detection** | `phase2-platform.test.ts` | Compat | macOS/Debian/Fedora/Arch package manager detection |
| **Dry-Run Planner** | `phase2-plan.test.ts` | Planning | Dry-run manifest generation, rejection exit behavior |
| **Workspace Manifest** | `phase3-manifest.test.ts` | Workspace | Manifest init, boundary enforcement, metadata-only serialization |
| **Drift Detection** | `phase3-drift.test.ts` | Workspace | Hash comparison, Modified/Missing status, scrubbed tracking mirror |
| **Healer** | `phase3-healer.test.ts` | Recovery | Known error routing to MITL, no auto-execution |
| **History & Rollback** | `phase3-history-rollback.test.ts` | Workspace | Shadow commit log, atomic restore pattern |
| **Carriers** | `carriers-*.test.ts` | 2 files | Registry presets, auth modes, transport headers, per-provider config |
| **UI** | `ui-spinner.test.ts`, `phase3-ui.test.ts` | UI | Spinner lifecycle, ANSI rendering |

### Running a Single Test

```bash
npm run build && node --test dist/tests/phase2-scrub.test.js
```

---

## Project Structure

```
getit/
├── src/
│   ├── index.ts                    # Entry point, CLI argument parsing, REPL loop
│   ├── update.ts                   # Self-update mechanism
│   │
│   ├── agent/                      # Agent orchestration layer
│   │   ├── loop.ts                 # Multi-turn conversation loop with MITL interception
│   │   ├── client.ts               # LLM request dispatcher with streaming support
│   │   ├── prompt.ts               # System prompt builder with environment context
│   │   └── tools.ts                # Tool schema definitions for LLM function calling
│   │
│   ├── carriers/                   # Multi-carrier LLM adapter framework
│   │   ├── registry.ts             # 11 carrier presets (OpenRouter, OpenAI, Anthropic, etc.)
│   │   ├── transport.ts            # HTTP transport layer with streaming and error scrubbing
│   │   ├── models.ts               # Model listing and caching per carrier
│   │   ├── doctor.ts               # Connectivity and configuration health checks
│   │   └── session.ts              # Runtime carrier/model switching
│   │
│   ├── discovery/                  # Environment fingerprinting
│   │   └── environment.ts          # Platform detection (arch, OS, package manager, tools)
│   │
│   ├── execution/                  # Command execution kernel
│   │   ├── async-process.ts        # Async spawn with timeout, stream capture, env scrubbing
│   │   └── log-buffer.ts           # Token-aware log truncation (2,000-token threshold)
│   │
│   ├── mitl/                       # Man-in-the-Loop approval gate
│   │   └── interceptor.ts          # ANSI card renderer, [Y/n/e/c] prompt, edit mode
│   │
│   ├── planning/                   # Dry-run planning subsystem
│   │   └── plan-queue.ts           # Roadmap manifest generation and rendering
│   │
│   ├── runtime/                    # REPL state management
│   │   └── session.ts              # Runtime session (profile, CWD, masking, transaction ID)
│   │
│   ├── security/                   # Security pipeline
│   │   ├── scrubber.ts             # Shannon entropy masking + pattern matching + stream scrubber
│   │   ├── secrets-loader.ts       # .getitrc / env-var API key loading and carrier config
│   │   ├── path-policy.ts          # Absolute path resolution, .getitignore enforcement
│   │   ├── policy.ts               # Global policy.json loading, rule evaluation, glob matching
│   │   ├── input-sanitizer.ts      # Shell cascade/redirect/subshell detection
│   │   └── env-scrubber.ts         # Process environment key stripping for child processes
│   │
│   ├── setup/                      # First-run configuration
│   │   └── wizard.ts               # Interactive setup wizard for carrier, model, and timeout
│   │
│   ├── tools/                      # Tool implementations
│   │   ├── registry.ts             # Tool dispatch router (name → handler mapping)
│   │   ├── execute-bash.ts         # Safe bash execution with CWD tracking and timeout
│   │   ├── manage-file.ts          # File create/read/patch operations with ledger snapshots
│   │   └── diff.ts                 # LCS-based unified diff generation for file patches
│   │
│   ├── ui/                         # Terminal UI utilities
│   │   ├── layout.ts               # ANSI-aware centering, box drawing, terminal width detection
│   │   └── spinner.ts              # Progress spinner with success/fail states
│   │
│   ├── workspace/                  # Workspace management subsystem
│   │   ├── manifest.ts             # .getit-manifest.json lifecycle, SHA-256 fingerprinting
│   │   ├── drift.ts                # Live vs. manifest hash comparison, drift categorization
│   │   ├── drift-advisor.ts        # AI-powered drift resolution suggestions
│   │   ├── tracking.ts             # Shadow Git repository for scrubbed file mirrors
│   │   ├── history.ts              # Shadow commit log viewer and rendering
│   │   ├── rollback.ts             # Atomic rollback with preview, path validation, MITL gate
│   │   ├── export.ts               # Bulk scrubbed workspace export
│   │   ├── healer.ts               # Rule-based dependency error detection and fix proposals
│   │   ├── boundary.ts             # Workspace root discovery and path containment
│   │   ├── profiles.ts             # Machine-specific profile directories (common/ + profiles/)
│   │   └── fs-utils.ts             # Atomic file write (UUID temp + rename pattern)
│   │
│   └── backup/                     # Undo and snapshot subsystem
│       ├── ledger.ts               # Transaction ledger for file mutation history
│       └── shadow-store.ts         # Pre-write snapshots, command recording, undo engine
│
├── tests/                          # 112-test native Node.js test suite
│   ├── functionality.test.ts       # Core architecture and utility tests
│   ├── safety.test.ts              # Security pipeline tests
│   ├── stage1-4.test.ts            # Stage verification tests
│   ├── phase2-*.test.ts            # Phase 2 feature tests (async, backup, policy, scrub, plan)
│   ├── phase3-*.test.ts            # Phase 3 feature tests (manifest, drift, healer, history)
│   ├── carriers-*.test.ts          # Carrier registry and transport tests
│   └── ui-spinner.test.ts          # UI component tests
│
├── .github/
│   └── copilot-instructions.md     # AI assistant context for repository navigation
│
├── package.json                    # Zero production deps; version 1.5.0
├── tsconfig.json                   # ES2022 target, NodeNext modules, strict mode
├── CHANGELOG.md                    # Full version history (Keep a Changelog format)
├── ARCHITECTURE.md                 # Deep-dive technical architecture documentation
├── API.md                          # Complete public API reference
├── SECURITY.md                     # Security model documentation
├── CONTRIBUTING.md                 # Contributor guide
├── AGENT_SPEC.md                   # Original agent specification document
├── LICENSE                         # ISC License
└── README.md                       # This file
```

---

## Version History

See [CHANGELOG.md](CHANGELOG.md) for the full version history.

| Version | Date | Highlights |
|---|---|---|
| **1.5.0** | 2026-05-24 | Documentation overhaul, entropy scrubber hardening, debug artifact cleanup, comprehensive JSDoc |
| **1.0.1** | 2026-05-23 | Post-publish patch for `bin` entry path |
| **1.0.0** | 2026-05-23 | Initial release — MITL gate, 11 carriers, security pipeline, workspace management |

---

## Design Philosophy

`getit` is built on three non-negotiable architectural laws:

1. **Isolated Execution Harness** — The tool interceptor is written from scratch. It acts as an absolute supervisor over the shell. No unstructured subshell is ever spawned by the model.
2. **Deterministic State Management** — Working directories and all file paths are maintained statefully in TypeScript. Absolute path resolution is enforced before every read, write, or policy check.
3. **Strict Parameter Typing** — The LLM communicates exclusively through structured JSON tool schemas (`execute_bash`, `manage_file`). Raw, unparsed shell string execution is architecturally impossible.

---

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Quick start:
```bash
npm install
npm run build
npm test          # All 112 tests must pass
```

Please maintain the **zero production dependencies** constraint. All features must use Node.js ≥20 native modules only.

---

## License

[ISC](LICENSE) — Copyright (c) 2026 Brian Laposa

---

## Contact

📬 **redstarapps@proton.me**

---

<div align="center">

*Built with zero dependencies. Every action, your approval.*

**getit v1.5.0**

</div>
