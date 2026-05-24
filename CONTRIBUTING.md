# Contributing to getit

Thank you for your interest in contributing to `getit`! This guide covers everything you need to get started.

---

## Table of Contents

1. [Development Setup](#development-setup)
2. [Project Conventions](#project-conventions)
3. [Making Changes](#making-changes)
4. [Testing](#testing)
5. [Code Style](#code-style)
6. [Pull Request Guidelines](#pull-request-guidelines)
7. [Architecture Overview](#architecture-overview)

---

## Development Setup

### Prerequisites

- **Node.js** ≥ 20.0.0 (required for native test runner and modern APIs)
- **npm** ≥ 10.0.0
- **TypeScript** 5.3+ (installed as dev dependency)
- **Git**

### Getting Started

```bash
# 1. Fork and clone the repository
git clone https://github.com/<your-username>/getit.git
cd getit

# 2. Install dev dependencies
npm install

# 3. Build
npm run build

# 4. Run the test suite
npm test

# 5. (Optional) Link for local CLI testing
npm link
```

### Build Commands

| Command | Description |
|---|---|
| `npm run build` | Compile TypeScript → `dist/` and set executable permissions |
| `npm run dev` | Build and run the CLI |
| `npm start` | Run the compiled CLI (`node dist/index.js`) |
| `npm test` | Build and run the full test suite |

---

## Project Conventions

### Zero Production Dependencies

This is the most important constraint. **`getit` has zero production dependencies.** All functionality must use Node.js ≥20 native modules only:

- `node:fs/promises` — File I/O
- `node:child_process` — Command execution
- `node:crypto` — Hashing
- `node:readline/promises` — Interactive input
- `node:test` — Test runner
- `node:http` / `node:https` — API transport
- `node:path`, `node:os`, `node:url` — Utilities

Only `typescript` and `@types/node` are allowed as dev dependencies.

### ESM Modules

The project uses ES modules (`"type": "module"` in `package.json`). All internal imports must use the `.js` extension:

```typescript
// ✅ Correct
import { scrubText } from '../security/scrubber.js';

// ❌ Wrong — missing .js extension
import { scrubText } from '../security/scrubber';
```

### TypeScript Configuration

- Target: `ES2022`
- Module: `NodeNext`
- Strict mode: enabled
- Source maps: enabled
- Output: `dist/`

---

## Making Changes

### Branch Naming

```
feature/<short-description>
fix/<issue-or-description>
docs/<what-you-documented>
```

### File Organization

```
src/
├── agent/          # Agent loop, LLM client, prompt builder, tool schemas
├── carriers/       # Multi-carrier adapter framework (11 providers)
├── discovery/      # Environment fingerprinting
├── execution/      # Async spawn, log truncation
├── mitl/           # Man-in-the-Loop approval gate
├── planning/       # Dry-run planner
├── runtime/        # Session state management
├── security/       # Scrubber, path policy, input sanitizer, env cleaner
├── setup/          # Configuration wizard
├── tools/          # Tool dispatch, bash execution, file operations
├── ui/             # Terminal layout, spinner
├── workspace/      # Manifest, drift, tracking, healer, rollback
├── backup/         # Ledger, shadow store, undo
├── index.ts        # CLI entry point
└── update.ts       # Self-update mechanism
```

### Adding a New Tool

1. Define the tool schema in `src/agent/tools.ts`
2. Implement the handler in `src/tools/`
3. Register the dispatch route in `src/tools/registry.ts`
4. Add MITL interception for any mutations
5. Write tests in `tests/`

### Adding a New Carrier

1. Add the carrier ID to the `CarrierId` type in `src/carriers/registry.ts`
2. Define the `CarrierPreset` in the presets array
3. Verify auth mode, base URL, and default model
4. Add tests in `tests/carriers-registry.test.ts`

---

## Testing

### Running Tests

```bash
# Full suite (builds first)
npm test

# Single test file
npm run build && node --test dist/tests/phase2-scrub.test.js

# Run with verbose output
npm run build && node --test --test-reporter=spec dist/tests/safety.test.js
```

### Writing Tests

Tests use Node's native test runner (`node:test`):

```typescript
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

describe('MyModule', () => {
  it('should do something', () => {
    const result = myFunction('input');
    assert.equal(result, 'expected');
  });
});
```

### Test Environment

Set `GETIT_TEST_MODE=true` to auto-approve MITL gates in tests:

```typescript
process.env.GETIT_TEST_MODE = 'true';
```

### Test Categories

| Category | Files | What to Test |
|---|---|---|
| **Unit tests** | `tests/*.test.ts` | Individual functions and classes |
| **Security tests** | `tests/safety.test.ts`, `tests/phase2-scrub.test.ts` | Path blocking, scrubbing, sanitization |
| **Integration tests** | `tests/stage*.test.ts` | Multi-component flows |
| **Workspace tests** | `tests/phase3-*.test.ts` | Manifest, drift, rollback |

### Coverage Expectations

All new features must include tests. The current suite has 112 tests — please ensure all pass before submitting a PR:

```bash
npm test
# Expected: 112 tests, 0 failures
```

---

## Code Style

### General Principles

- **Strict TypeScript** — No `any` without justification. Use proper interfaces and types.
- **Named exports** — Prefer `export function` over `export default`.
- **Small functions** — Each function should do one thing well.
- **JSDoc comments** — All public exports should have JSDoc with `@param`, `@returns`, and `@example` where appropriate.
- **Module-level documentation** — Each file should have a `@module` JSDoc block explaining its purpose.

### Naming Conventions

| Element | Convention | Example |
|---|---|---|
| Files | `kebab-case.ts` | `path-policy.ts` |
| Functions | `camelCase` | `validatePath()` |
| Classes | `PascalCase` | `AgentLoop` |
| Interfaces | `PascalCase` | `CarrierPreset` |
| Types | `PascalCase` | `PolicyProfile` |
| Constants | `UPPER_SNAKE_CASE` | `MANIFEST_FILENAME` |
| Enum values | `PascalCase` | — |

### Security-Sensitive Code

When writing code that handles secrets, paths, or command execution:

1. **Always scrub before display** — Use `scrubText()` before writing to stdout or model history
2. **Always resolve paths** — Use `resolveRealPath()` before any policy check
3. **Always use safe env** — Use `getSafeEnv()` before spawning child processes
4. **Always use atomic writes** — Use `atomicWriteFile()` for any file mutation
5. **Never auto-execute** — Every mutation must pass through the MITL gate

---

## Pull Request Guidelines

### Before Submitting

1. ✅ All 112+ tests pass (`npm test`)
2. ✅ `npm run build` completes with zero TypeScript errors
3. ✅ New features include tests
4. ✅ JSDoc is added for all new public exports
5. ✅ Zero production dependencies constraint is maintained
6. ✅ CHANGELOG.md is updated with your changes

### PR Description Template

```markdown
## Summary
Brief description of what this PR does.

## Changes
- Change 1
- Change 2

## Testing
How you tested these changes.

## Checklist
- [ ] All tests pass
- [ ] Zero production dependencies maintained
- [ ] JSDoc added for new public APIs
- [ ] CHANGELOG.md updated
```

### Review Process

1. Open a PR against `main`
2. Ensure CI passes (all tests green)
3. Address review feedback
4. Squash merge when approved

---

## Architecture Overview

For a deep-dive into the codebase architecture, see:

- [ARCHITECTURE.md](ARCHITECTURE.md) — Module interactions, data flow, design decisions
- [API.md](API.md) — Complete public API reference
- [SECURITY.md](SECURITY.md) — Security model and threat mitigation

---

## Questions?

📬 **redstarapps@proton.me**

---

*Thank you for contributing to getit!*
