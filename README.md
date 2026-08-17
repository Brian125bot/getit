# getit v2.0

**Lightweight terminal-native Man-in-the-Loop workspace agent.**

getit is a zero-dependency CLI agent that runs inside your terminal, using LLM providers via OpenRouter (or any OpenAI-compatible API) to assist with development tasks. Every action passes through a human approval gate — the MITL (Man-in-the-Loop) interceptor — before execution.

---

## What's New in v2.0

Version 2.0 transforms getit into a complete workspace operating system while strictly adhering to a zero-production-dependency architecture.

### New Modules

| Module | Description |
|--------|-------------|
| **Plugin Tool Registry** | Extend getit with custom tools loaded from `.getit/tools/` or `~/.config/getit/tools/` |
| **Session Memory** | Persistent session history, project detection, and learned user preferences |
| **Task Recipes** | Record, save, and replay multi-step workflows as YAML recipe files |
| **Watch Mode** | File system monitoring with auto-build, drift detection, and custom action hooks |
| **Rich TUI Dashboard** | Multi-pane terminal dashboard showing session status, watch events, and active tools |
| **Multi-Machine Sync** | AES-256-GCM encrypted credential vault and profile export/import for multi-machine synchronization |
| **TerminalKit UI Shell** | Low-level ANSI rendering engine with surfaces, markup, animations, and themes |
| **CLI Control Plane** | Command palette, input classification, contextual hints, multi-line editor, keymaps, and macros |
| **OpenRouter Auto-Switcher** | Intelligent model routing based on task classification, cost limits, and context window |

---

## Quick Start

```bash
# Clone and build
git clone https://github.com/Brian125bot/getit.git
cd getit
npm install
npm run build

# Run interactive REPL
node dist/src/index.js

# Or run one-shot command
node dist/src/index.js "Create a hello world TypeScript file"
```

### Requirements

- **Node.js ≥ 20.0.0** (uses native `node:fs`, `node:crypto`, `node:test`, `node:util`)
- **Zero production dependencies** — relies exclusively on Node.js native modules
- An API key from [OpenRouter](https://openrouter.ai/) or any OpenAI-compatible provider

---

## CLI Usage & Commands

```bash
Usage: getit [options] [command] [prompt...]
```

### Options

| Option | Description |
|--------|-------------|
| `-h, --help` | Show CLI help guide and exit |
| `-v, --version` | Display version and exit |
| `--model <name>` | Override the active completion model |
| `--timeout <ms>` | Set command execution timeout limit in milliseconds |
| `--dry-run` | Queue mutations into a dry-run roadmap before execution |
| `--profile <name>` | Set policy profile (`strict`, `normal`, or `override`) |
| `--allow-root` | Override root execution restriction |
| `--setup` | Launch interactive key setup wizard |

### Subcommands

| Command | Description |
|---------|-------------|
| `getit run <prompt>` | Execute a prompt in one-shot mode and exit |
| `getit config` | View current carrier, model, timeout, and runtime settings |
| `getit doctor` | Run environment and carrier connectivity health checks |
| `getit models` | List available models for the active carrier |
| `getit manifest init` | Initialize workspace configuration tracking in current directory |
| `getit status` | Inspect offline workspace configuration drift |
| `getit inspect <file>` | Inspect credential-scrubbed tracking mirror for a file |
| `getit stage` / `getit resolve` | Interactively resolve workspace configuration drift |
| `getit export [dir]` | Export scrubbed mirror of all tracked files |
| `getit history` / `getit log` | View shadow Git tracking commit history |
| `getit rollback <hash> [file]` | Preview and roll back workspace state to a previous tracking commit |
| `getit undo` | Undo the latest file/command transaction via shadow store |
| `getit watch` | Launch file system watcher daemon |
| `getit plugins [reload]` | List or reload custom plugin tools |
| `getit sync` | List multi-machine sync profiles |
| `getit recipe run <name>` | Execute a saved task recipe |

---

## Interactive REPL Slash Commands

Inside the interactive REPL (`node dist/src/index.js`), the following slash commands are available:

| Command | Description |
|---------|-------------|
| `/help` | Show available slash commands |
| `/exit`, `/quit` | Exit the session |
| `/clear` | Clear the terminal screen |
| `/reset` | Reset conversation context and start fresh |
| `/env` | Display runtime environment and dependency status |
| `/cd <path>` | Change stateful working directory |
| `/config` | Display runtime options card |
| `/carrier [id]` | Show active carrier or switch provider (`openrouter`, `openai`, `groq`, `ollama`, etc.) |
| `/models [refresh]` | List available models for the active carrier |
| `/model [name]` | View or change active model |
| `/setup` | Launch interactive configuration wizard |
| `/undo` | Restore latest restorable transaction |
| `/dry-run [on|off]` | Display or toggle dry-run roadmap mode |
| `/policy` | Display active security policy profile |
| `/status` | View workspace offline drift status |
| `/resolve`, `/stage` | Interactively resolve workspace drift |
| `/export [dir]` | Export scrubbed copy of tracked files |
| `/log`, `/history` | View shadow Git tracking commit log |
| `/rollback <hash> [file]` | Preview and roll back workspace to a past commit |
| `/dashboard` | Render rich multi-pane TUI dashboard |
| `/watch [start|stop|status]` | Control file system watch daemon |
| `/plugins [reload|info <name>]` | Manage and inspect custom plugin tools |
| `/memory [clear]` | View or manage session and project memory |
| `/context` | View injected project and session context |
| `/recipe [list|run|record|save|create]` | Manage, record, and execute task recipes |
| `/vault [status|init|unlock|lock|get|set|delete|list]` | Manage AES-256-GCM encrypted vault |
| `/sync [status|push|pull]` | Export or import multi-machine runtime profiles |
| `/palette [query]` | Search command palette |

---

## Architecture Overview

```
src/
├── agent/              # Core agent loop, system prompt builder, tool schemas, streaming LLM client
├── tools/              # Central dispatch, bash execution, file create/read/patch operations, diff generator
├── mitl/               # Man-in-the-Loop gate with ANSI card UI and interactive approval prompt
├── plugins/            # Dynamic plugin discovery, loader, validator, and registry
├── memory/             # Session history logger, project tech stack detection, learned user preferences
├── recipes/            # Zero-dependency YAML parser, live workflow recorder, and recipe execution engine
├── watcher/            # File system watcher daemon, debouncing, build system integration, and hooks
├── ui/                 # TerminalKit ANSI engine, dashboard layout, spinners, surfaces, markup, and themes
├── vault/              # AES-256-GCM encrypted credential vault with PBKDF2 key derivation
├── sync/               # Multi-machine profile export/import and conflict resolution
├── repl/               # Control plane: command palette, classifier, hints, editor, keymaps, macros
├── carriers/           # Multi-carrier transport, OpenRouter catalog, telemetry, and model switcher
├── runtime/            # Runtime session state, CWD tracking, dry-run plan queue
├── security/           # Entropy & pattern secret scrubber, path policy validator, input sanitizer, env cleaner
├── workspace/          # Workspace manifest, drift detection, shadow tracking, history, rollback, exporter, healer
├── setup/              # Interactive configuration wizard
├── backup/             # Ledger transaction logger and shadow-store undo manager
└── index.ts            # Main CLI entry point and REPL dispatch
```

---

## Plugin System

Extend getit with custom tools by adding JavaScript or TypeScript files to `.getit/tools/` in your workspace or `~/.config/getit/tools/` globally:

```typescript
// .getit/tools/my-tool.ts
export default {
  name: 'my_custom_tool',
  description: 'Performs custom workspace automation',
  risk: 'write', // 'read' | 'write' | 'system'
  parameters: {
    type: 'object',
    properties: {
      target: { type: 'string', description: 'Target path or resource' }
    },
    required: ['target']
  },
  execute: async (args) => {
    return { output: `Processed target: ${args.target}` };
  }
};
```

---

## Recipe System

Record multi-step workflows during interactive turns and replay them later:

```bash
# In REPL: start recording
/recipe record my-deploy

# ... execute commands and file operations ...

# Save recorded workflow
/recipe save my-deploy

# Replay recipe via CLI
getit recipe run my-deploy
```

---

## Architectural Guardrails & Security Model

- **MITL Gate:** Every mutating tool call requires explicit human confirmation (`[Y/n/e/c]`).
- **Secret Scrubbing:** Multi-layered scrubber combining Shannon entropy, known secret tracking, and pattern matching.
- **Path Policies:** Normalization and validation preventing directory traversal, symlink bypasses, and unauthorized system access.
- **Encrypted Vault:** AES-256-GCM encryption with PBKDF2 (310,000 iterations) for secure secret and token storage.
- **Zero Production Dependencies:** Pure Node.js implementation eliminating supply chain risks.

---

## Documentation

For detailed guides and references, see:

- [API Reference](docs/API.md) — Comprehensive API documentation for all public modules.
- [Architecture Guide](docs/ARCHITECTURE.md) — System design, data flow, and module boundaries.
- [User Guide](docs/USER_GUIDE.md) — CLI subcommands, slash commands, REPL controls, recipes, and sync instructions.

---

## License

ISC © Brian Laposa
