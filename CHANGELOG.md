# Changelog

All notable changes to **getit** are documented in this file.

## [2.0.0] — 2025-05-24

### 🎉 Major Release — Workspace Operating System

v2.0 transforms getit from a focused CLI agent into a complete workspace operating system with 9 new modules, all maintaining the zero-production-dependency constraint.

### Added

#### Module A — Plugin Tool Registry
- `src/plugins/types.ts` — `PluginToolDefinition`, `PluginRiskLevel`, `PluginParameterSchema`, `PluginExecutionResult` interfaces
- `src/plugins/validator.ts` — Plugin definition validation with built-in name collision guard
- `src/plugins/loader.ts` — Plugin discovery from `.getit/plugins/` (workspace) and `~/.config/getit/plugins/` (global)
- `src/plugins/registry.ts` — Plugin lifecycle: init, reload, execute, event hooks, MITL approval card formatting

#### Module B — Session Memory
- `src/memory/sessions.ts` — NDJSON session history with per-workspace fingerprinting
- `src/memory/projects.ts` — Auto-detection of tech stacks, common commands, and project learnings
- `src/memory/preferences.ts` — Learned user preferences (code style, shell, editor, naming conventions)

#### Module C — Task Recipes
- `src/recipes/types.ts` — Recipe, RecipeStep, RecipeParameter, RecordingSession types
- `src/recipes/yaml-parser.ts` — Zero-dependency YAML parser and serializer
- `src/recipes/recorder.ts` — Live recording of agent tool calls as recipe steps
- `src/recipes/engine.ts` — Recipe execution with template resolution, conditions, retries, capture

#### Module D — Watch Mode
- `src/watcher/daemon.ts` — File system watcher using `fs.watch()` with glob patterns, debouncing, recursive watching
- `src/watcher/hooks.ts` — Action hooks: build, test, lint, drift-check, custom commands
- `src/watcher/build.ts` — Auto-detect build systems (npm/pnpm/yarn/bun/cargo/go)
- `src/watcher/drift.ts` — Watch-mode drift detection integration
- `src/watcher/notifications.ts` — Non-intrusive terminal notification system

#### Module E — Rich TUI Dashboard
- `src/ui/dashboard.ts` — Multi-pane ANSI dashboard with session status, plugin counts, memory stats
- `src/ui/panes.ts` — Pane layout system with toggle, priority sorting, and configurable renderers

#### Module F — Multi-Machine Sync
- `src/vault/vault.ts` — AES-256-GCM encrypted vault with PBKDF2 key derivation (310,000 iterations)
- `src/sync/profiles.ts` — Profile create/load/list/delete/export/import
- `src/sync/merge.ts` — Conflict detection, resolution strategies (local/remote/manual), union merging

#### Module G — TerminalKit UI Shell
- `src/ui/terminalkit/ansi.ts` — SGR, FG/BG colors, 256-color, true color, cursor, screen control
- `src/ui/terminalkit/capabilities.ts` — Terminal feature detection with graceful degradation
- `src/ui/terminalkit/surface.ts` — 2D cell-based rendering surface with compositing
- `src/ui/terminalkit/markup.ts` — Rich text markup parser (`*bold*`, `_italic_`, `!color!text!`)
- `src/ui/terminalkit/animate.ts` — Progress bars, animated spinners, typing effects
- `src/ui/terminalkit/glyphs.ts` — Named glyph library with Unicode/ASCII auto-fallback
- `src/ui/terminalkit/themes/builtin/default.ts` — Theme system with default, dark, and minimal themes

#### Module H — CLI Control Plane
- `src/repl/control-plane/palette.ts` — Fuzzy-searchable command palette with all built-in commands
- `src/repl/control-plane/classifier.ts` — Input classification: slash commands, recipes, macros, natural language
- `src/repl/control-plane/hints.ts` — Contextual hint provider system with auto-complete
- `src/repl/control-plane/editor.ts` — Multi-line input editor with readline-style keybindings
- `src/repl/control-plane/macros.ts` — User-defined command macros with argument substitution
- `src/repl/control-plane/keymap.ts` — Configurable keyboard shortcut mapping

#### Module I — OpenRouter Auto-Switcher
- `src/carriers/openrouter/catalog.ts` — Model catalog fetching with 30-minute cache
- `src/carriers/openrouter/router.ts` — Intelligent model routing by task type, cost, context, capabilities
- `src/carriers/openrouter/telemetry.ts` — Per-model usage tracking, cost reporting, NDJSON persistence

### Changed

- `src/agent/tools.ts` — `getToolSchemas()` function dynamically merges built-in + plugin tool schemas
- `src/agent/loop.ts` — Memory context injection, dynamic schemas, recipe recording integration
- `src/agent/prompt.ts` — Project memory, user preferences, and plugin awareness in system prompt
- `src/tools/registry.ts` — Plugin tool dispatch fallback for unknown tool names
- `src/mitl/interceptor.ts` — Extended `InterceptionContext` type with PLUGIN, RECIPE STEP, WATCH ACTION
- `src/runtime/session.ts` — New fields: `watchActive`, `vaultUnlocked`, `recipeRecording`, `activeRecipe`
- `src/planning/plan-queue.ts` — `PlannedToolName` widened to `string` for plugin tools; generic roadmap rendering
- `package.json` — Version bumped to 2.0.0

### Removed

- `PHASE2.MD` — Superseded by V2_SPEC.md
- `PHASE3.md` — Superseded by V2_SPEC.md
- `finalphase.md` — Superseded by V2_SPEC.md
- `v1.1.md` — Superseded by CHANGELOG.md
- `AGENT_SPEC.md` — Superseded by V2_SPEC.md

---

## [1.5.0] — 2025-05-24

### Added
- Comprehensive documentation: README.md, ARCHITECTURE.md, API.md, SECURITY.md, CONTRIBUTING.md
- Detailed CHANGELOG with full v1.0–v1.5 history
- V2_SPEC.md — Complete v2.0 specification with 9 modules

### Changed
- Improved code documentation across all source files

---

## [1.4.0] — 2025-05-23

### Added
- Carrier doctor diagnostic system (`src/carriers/doctor.ts`)
- Workspace drift advisor (`src/workspace/drift-advisor.ts`)
- Workspace healer for automatic remediation (`src/workspace/healer.ts`)
- Workspace export with scrubbing (`src/workspace/export.ts`)

---

## [1.3.0] — 2025-05-22

### Added
- Carrier transport layer with model resolution (`src/carriers/transport.ts`)
- Multi-carrier session management (`src/carriers/session.ts`)
- Carrier model definitions (`src/carriers/models.ts`)
- Setup wizard for first-run configuration (`src/setup/wizard.ts`)

---

## [1.2.0] — 2025-05-21

### Added
- Plan queue for dry-run mode (`src/planning/plan-queue.ts`)
- Backup ledger for file operations (`src/backup/ledger.ts`)
- Shadow store for file snapshots (`src/backup/shadow-store.ts`)
- Workspace rollback capabilities (`src/workspace/rollback.ts`)
- Workspace history tracking (`src/workspace/history.ts`)
- Async process execution (`src/execution/async-process.ts`)
- Log buffer for process output (`src/execution/log-buffer.ts`)

---

## [1.1.0] — 2025-05-20

### Added
- Workspace drift detection (`src/workspace/drift.ts`)
- Workspace tracking system (`src/workspace/tracking.ts`)
- Workspace profiles (`src/workspace/profiles.ts`)
- Workspace manifest (`src/workspace/manifest.ts`)
- Environment scrubber (`src/security/env-scrubber.ts`)
- Policy configuration (`src/security/policy.ts`)

---

## [1.0.0] — 2025-05-19

### Added
- Core agent loop with streaming LLM support
- MITL interceptor with Y/n/e/c approval gate
- Built-in tools: execute_bash, manage_file (read/create/patch)
- Secret scrubbing with Shannon entropy detection
- Path policy enforcement
- Workspace boundary detection
- Terminal UI (layout, spinner)
- OpenRouter and OpenAI-compatible carrier support
- Full test suite (26 test files)
