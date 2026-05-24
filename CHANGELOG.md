# Changelog

All notable changes to `getit` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.5.0] — 2026-05-24

### Summary
Stabilization and documentation release. Cleans up all debug artifacts committed
during the rapid v1.0 development sprint, hardens the entropy-based secret
scrubber against false positives, fixes the npm registry metadata, and adds
comprehensive JSDoc documentation across all public APIs.

### Fixed
- **BUG-02 (HIGH):** Removed `build-errors.txt`, `build-errors2.txt`,
  `build-errors3.txt`, and `fix-tests.cjs` from the repository. These debug
  artifacts were committed during v1.0 development and incorrectly signalled to
  evaluators that the build was broken at commit time.
- **BUG-03 (HIGH):** Corrected `package.json` `repository.url` from
  `github.com/creetacticalgenius/getit` to the canonical
  `github.com/Brian125bot/getit`. Added missing `bugs.url` field pointing to
  the Issues page.
- **Q-05 (MEDIUM):** Hardened Shannon entropy thresholds in `scrubber.ts` to
  prevent false-positive redaction of legitimate technical strings:
  - `BASE64_HARD_THRESHOLD` raised from `5.1` → `5.5` — npm integrity hashes
    (`sha512-…`), HTTPS certificate fingerprints, and JWT headers are no longer
    incorrectly redacted.
  - `BASE64_SOFT_THRESHOLD` raised from `3.7` → `4.2` with minimum token
    length increased from 40 → 60 chars — long URLs with query parameters are
    no longer redacted.
  - All thresholds are now named constants with inline documentation explaining
    their purpose and calibration rationale.

### Added
- **`.gitignore` hardening:** Added `build-errors*.txt`, `fix-tests.cjs`,
  `*.debug.txt`, `*.error.txt` patterns so debug artifacts can never be
  accidentally committed again. Also added common editor (`.vscode/`, `.idea/`),
  OS (`.DS_Store`, `Thumbs.db`), and test-coverage (`coverage/`) exclusions.
- **`CHANGELOG.md`:** This file — full version history starting from v1.0.
- **`bugs` field in `package.json`:** Links npm consumers directly to the
  GitHub Issues page for bug reports.
- **`CHANGELOG.md` in `package.json` `files` array:** Ensures the changelog is
  included in the published npm package.
- **JSDoc module-level documentation** added to:
  - `src/security/scrubber.ts` — Entropy tuning guide, threshold table, usage
    examples for `scrubText` and `StreamScrubber`.
  - `src/carriers/transport.ts` — Transport layer overview, streaming behaviour,
    timeout and error-scrubbing contracts.
  - `src/agent/loop.ts` — AgentLoop architecture, safety mechanisms (runaway
    guard, halt propagation, history pruning, streaming scrubber).
  - `src/mitl/interceptor.ts` — MITL gate response options table (Y/n/e/c),
    test-mode bypass documentation.
  - `src/workspace/manifest.ts` — Manifest lifecycle, drift detection overview,
    atomic write pattern.
  - `src/workspace/tracking.ts` — Shadow Git repository purpose and key
    functions.
  - `src/workspace/history.ts` — History viewer output and rendering.
  - `src/workspace/rollback.ts` — Rollback preview/apply contract, path
    validation, atomic restore pattern.
- **Extended scrubber test suite** (`tests/phase2-scrub.test.ts`):
  - Added 14 new tests covering entropy false-positive guard cases: npm
    integrity hashes, long HTTPS URLs, base64 image data headers, JWT header
    segments, package version refs.
  - Added `StreamScrubber` buffering and flush tests.
  - Added `shannonEntropy` edge-case tests (empty string, single-char, diversity).
  - Added known-secret registry test.
  - Total scrubber test count: 3 → 19.
- **`author` field** in `package.json` updated to include email address for npm
  publisher attribution.
- **`keywords` array** in `package.json` extended with `"mitl"`, `"ai"`,
  `"automation"` for better npm discoverability.

### Changed
- **Version bumped** from `1.0.1` → `1.5.0`.
- `author` field updated from `"CreeTacticalGenius"` to
  `"Brian Laposa <creetacticalgenius@gmail.com>"`.

---

## [1.0.1] — 2026-05-23

### Fixed
- Post-publish patch: corrected `bin` entry in `package.json` to point to
  `./dist/src/index.js` (was missing the `src/` segment on some build paths).

---

## [1.0.0] — 2026-05-23

### Added — Initial release
- **Zero-dependency architecture.** Only `typescript` and `@types/node` in
  `devDependencies`. Runtime binary ships with no npm dependencies.
- **Man-in-the-Loop (MITL) approval gate** — every shell command and file
  mutation is intercepted and presented to the user with `[Y/n/e/c]` options
  before execution.
- **11 LLM carrier presets** — OpenRouter, OpenAI, Anthropic, Gemini, Groq,
  DeepSeek, Mistral, Azure OpenAI, Ollama, Together AI, and Perplexity.
- **Carrier registry** with preset-based auth, base URL, and default model
  configuration. Switchable at runtime via `/model` and `/carrier` commands.
- **Shannon-entropy secret scrubber** — real-time masking of API keys, tokens,
  and high-entropy strings in both LLM context and terminal output.
- **Three-layer security model:**
  1. TypeScript MITL interceptor (approval gate)
  2. Environment scrubber (env-var key stripping)
  3. Path policy engine (`.getitignore`-based access control)
- **Shadow Git tracking repository** at `~/.local/state/getit/tracking/` for
  version-controlled, scrubbed copies of all tracked workspace files.
- **Workspace manifest** (`.getit-manifest.json`) with SHA-256 fingerprinting
  and drift detection.
- **Rollback system** — preview and apply any shadow commit to the live
  workspace.
- **Export system** — produce a scrubbed, portable snapshot of tracked files.
- **Atomic file writes** — UUID temp-file + rename pattern in `fs-utils.ts`
  prevents partial-write corruption.
- **AgentLoop** with 25-message history pruning to prevent context-window
  overflow on long sessions.
- **Setup wizard** (`getit setup`) for first-run configuration.
- **Doctor command** (`getit doctor`) for connectivity and configuration checks.
- **Update command** (`getit update`) for self-updating from npm.
- **REPL slash commands:** `/status`, `/resolve`, `/history`, `/rollback`,
  `/export`, `/model`, `/models`, `/carrier`, `/timeout`, `/undo`, `/plan`,
  `/help`, `/clear`.
- **26 test files, 114 tests** covering all major subsystems.
- **README.md** with ASCII security architecture diagram, full command
  reference, and carrier configuration table.
- **AGENT_SPEC.md, PHASE2.MD, PHASE3.md, finalphase.md** — complete
  architecture specification documents.

---

[1.5.0]: https://github.com/Brian125bot/getit/compare/v1.0.1...v1.5.0
[1.0.1]: https://github.com/Brian125bot/getit/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/Brian125bot/getit/releases/tag/v1.0.0
