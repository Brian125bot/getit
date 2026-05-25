# getit v2.0

**Lightweight terminal-native Man-in-the-Loop workspace agent.**

getit is a zero-dependency CLI agent that runs inside your terminal, using LLM providers via OpenRouter (or any OpenAI-compatible API) to assist with development tasks. Every action passes through a human approval gate — the MITL (Man-in-the-Loop) interceptor — before execution.

## What's New in v2.0

Version 2.0 is a major expansion that transforms getit from a focused CLI agent into a complete workspace operating system, while maintaining its zero-dependency architecture.

### New Modules

| Module | Description |
|--------|-------------|
| **Plugin Tool Registry** | Extend getit with custom tools loaded from `.getit/plugins/` or `~/.config/getit/plugins/` |
| **Session Memory** | Persistent session history, project detection, and learned user preferences |
| **Task Recipes** | Record, save, and replay multi-step workflows as YAML recipe files |
| **Watch Mode** | File system monitoring with auto-build, drift detection, and custom hooks |
| **Rich TUI Dashboard** | Multi-pane terminal dashboard showing session status, events, and stats |
| **Multi-Machine Sync** | AES-256-GCM encrypted vault and profile import/export for syncing across machines |
| **TerminalKit UI Shell** | Low-level ANSI rendering engine with surfaces, markup, animations, and themes |
| **CLI Control Plane** | Command palette, input classification, macros, multi-line editor, and key bindings |
| **OpenRouter Auto-Switcher** | Intelligent model routing based on task type, cost limits, and context length |

## Quick Start

```bash
# Clone and build
git clone https://github.com/Brian125bot/getit.git
cd getit
npm install
npm run build

# Run
node dist/src/index.js
```

### Requirements

- **Node.js ≥ 20** (uses native `fs.watch`, `crypto`, `node:test`)
- **Zero production dependencies** — only Node.js built-ins
- An API key from [OpenRouter](https://openrouter.ai/) or any OpenAI-compatible provider

## Architecture

```
src/
├── agent/              # Core agent loop, prompt builder, tool schemas
│   ├── loop.ts         # Multi-turn conversation loop with memory injection
│   ├── prompt.ts       # System prompt builder with project/preference context
│   ├── tools.ts        # Dynamic tool schema merging (built-in + plugins)
│   └── client.ts       # LLM API client with streaming
├── tools/              # Built-in tool implementations
│   ├── registry.ts     # Central dispatch with plugin fallback
│   ├── execute-bash.ts # Shell command execution
│   └── manage-file.ts  # File read/create/patch operations
├── mitl/               # Man-in-the-Loop approval gate
│   └── interceptor.ts  # ANSI approval cards, Y/n/e/c prompt
├── plugins/            # [NEW] Plugin tool system
│   ├── types.ts        # Plugin interfaces and types
│   ├── loader.ts       # Plugin discovery and compilation
│   ├── validator.ts    # Plugin definition validation
│   └── registry.ts     # Plugin lifecycle management
├── memory/             # [NEW] Session memory system
│   ├── sessions.ts     # NDJSON session history
│   ├── projects.ts     # Project detection and tech stack memory
│   └── preferences.ts  # Learned user preferences
├── recipes/            # [NEW] Task recipe system
│   ├── types.ts        # Recipe/step interfaces
│   ├── yaml-parser.ts  # Zero-dep YAML parser
│   ├── recorder.ts     # Live recipe recording
│   └── engine.ts       # Recipe execution engine
├── watcher/            # [NEW] File system watch mode
│   ├── daemon.ts       # fs.watch() daemon with debouncing
│   ├── hooks.ts        # Action hooks (build, test, drift)
│   ├── build.ts        # Auto-detect build system
│   ├── drift.ts        # Drift detection integration
│   └── notifications.ts# Terminal notifications
├── ui/                 # Terminal UI components
│   ├── dashboard.ts    # [NEW] Rich TUI dashboard
│   ├── panes.ts        # [NEW] Pane layout system
│   ├── layout.ts       # ANSI layout utilities
│   ├── spinner.ts      # Terminal spinner
│   └── terminalkit/    # [NEW] Low-level UI rendering engine
│       ├── ansi.ts     # ANSI escape sequence primitives
│       ├── capabilities.ts # Terminal capability detection
│       ├── surface.ts  # 2D rendering surface
│       ├── markup.ts   # Rich text markup parser
│       ├── animate.ts  # Progress bars, spinners, effects
│       ├── glyphs.ts   # Unicode/ASCII glyph library
│       └── themes/     # Color theme system
├── vault/              # [NEW] Encrypted credential vault
│   └── vault.ts        # AES-256-GCM vault with PBKDF2
├── sync/               # [NEW] Multi-machine sync
│   ├── profiles.ts     # Profile export/import
│   └── merge.ts        # Conflict detection and resolution
├── repl/               # [NEW] REPL control plane
│   └── control-plane/
│       ├── palette.ts  # Fuzzy-searchable command palette
│       ├── classifier.ts # Input type classification
│       ├── hints.ts    # Contextual auto-complete hints
│       ├── editor.ts   # Multi-line input editor
│       ├── macros.ts   # User-defined command macros
│       └── keymap.ts   # Keyboard shortcut mapping
├── carriers/           # LLM provider management
│   └── openrouter/     # [NEW] Auto-switcher
│       ├── catalog.ts  # Model catalog with caching
│       ├── router.ts   # Intelligent model selection
│       └── telemetry.ts# Usage tracking and cost reporting
├── runtime/            # Runtime session state
├── security/           # Secret scrubbing, path policies
├── workspace/          # Workspace boundary, drift, manifests
├── planning/           # Dry-run plan queue
├── backup/             # Ledger and shadow store
└── index.ts            # CLI entry point
```

## Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all available commands |
| `/exit` | Exit the session |
| `/clear` | Clear terminal screen |
| `/reset` | Clear conversation context |
| `/model` | Display or change active model |
| `/carrier` | Show or switch LLM provider |
| `/status` | Display workspace drift status |
| `/resolve` | Interactively resolve drift |
| `/undo` | Restore latest transaction |
| `/dry-run` | Toggle dry-run mode |
| `/watch` | Toggle file watch mode |
| `/dashboard` | Show system dashboard |
| `/vault` | Manage encrypted vault |
| `/recipe` | Manage task recipes |
| `/plugins` | List loaded plugins |
| `/memory` | Show session memory |
| `/pref` | Set user preferences |
| `/theme` | Switch UI theme |
| `/macro` | Define command macros |

## Plugin System

Create custom tools by adding TypeScript files to `.getit/plugins/` in your workspace or `~/.config/getit/plugins/` globally:

```typescript
// .getit/plugins/my-tool.ts
export default {
  name: 'my_custom_tool',
  description: 'Does something useful',
  riskLevel: 'low',
  parameters: [
    { name: 'input', type: 'string', required: true, description: 'Input text' }
  ],
  execute: async (args) => {
    return { success: true, output: `Processed: ${args.input}` };
  }
};
```

## Recipe System

Record workflows and replay them:

```bash
# Start recording
/recipe record my-deploy "Deploy to production"

# ... perform actions naturally ...

# Stop and save
/recipe stop

# Replay later
@my-deploy
```

## Security Model

- **MITL gate:** Every tool call requires human approval (Y/n/e/c)
- **Secret scrubbing:** Shannon entropy + pattern matching strips secrets from output
- **Path policies:** Configurable allow/deny lists for file system access
- **Vault encryption:** AES-256-GCM with PBKDF2 (310,000 iterations) for stored credentials
- **Plugin sandboxing:** Plugins declare risk levels; high-risk plugins require explicit approval

## License

ISC © Brian Laposa
