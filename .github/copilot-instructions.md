# Copilot instructions — getit

Purpose: quick reference for future Copilot CLI sessions. Focused on build/test commands, high-level architecture, and repository-specific conventions.

1) Build, test, and lint commands
- Install dev deps: npm install
- Build: npm run build    # runs: tsc -> outputs JS into dist/
- Dev (build + run): npm run dev
- Start (run compiled CLI): npm start  # runs node dist/index.js
- Full test suite: npm test
  - Implementation: runs tsc then Node's native test runner on dist/tests/*.test.js
- Run a single test (example):
  npm run build && node --test dist/tests/phase2-plan.test.js
  (Or: tsc && node --test dist/tests/<test-file>.test.js)
- Lint: no linter script present in package.json (add intentionally if needed).

2) High-level architecture (big picture)
- Language & runtime: TypeScript targeting Node.js (package.json requires node >=20).
- CLI entry: src/index.ts -> compiled to dist/src/index.js; published bin is dist/index.js.
- Major runtime areas (map these to src/ and dist/):
  - Agent loop & client/prompt: src/agent/*  (persistent REPL, multi-turn state)
  - Tool registry & implementations: src/tools/* (manage-file, diff, execute-bash)
  - Execution harness: src/execution/* (async child process handling, log buffering)
  - Planning & queue: src/planning/*  (plan-queue, staged features)
  - Runtime session state: src/runtime/session.ts  (holds working directory, env)
  - Backup & undo ledger: src/backup/* (snapshots and restoration)
  - Security & sanitization: src/security/* (path policy, scrubbers, banned paths)
  - Setup & wizard: src/setup/* (install/link helpers)
- Configuration & policies: .getitignore and $XDG_CONFIG_HOME/getit/policy.json influence path policies and allowed operations.

3) Key conventions and repository-specific patterns
- Zero production dependencies: only devDependencies (typescript, @types/node). Build output in dist/ is the canonical runtime artifact.
- Tests execute against compiled JS in dist/tests/*.test.js — always build (tsc) before running Node's test runner.
- Single-test workflow: compile (tsc) then call node --test on a specific compiled test file.
- Security-first design:
  - Absolute path enforcement for file ops; avoid relying on relative paths in tool implementations.
  - Banned paths include (~/.ssh, /etc, /boot, /dev). Agent enforces fail-closed behavior on violations and non-zero command exits.
  - Environment secrets: OPENROUTER_API_KEY (and other tokens) are scrubbed before any child-process exec. Expect code to delete these from exec env.
- Tool calling: interactions are structured (typed JSON schemas). Avoid sending raw, concatenated shell strings to model-driven flows.
- MITL gating: all external effects show an approval card and accept exactly [Y/n/e]; tests exercise this behavior.
- Packaging: package.json 'files' lists dist/, README.md, LICENSE, index.ts; bin points to dist/index.js. Use npm link or symlink to ~/.local/bin/getit for local CLI usage.
- Node engine requirement: Node >= 20 — some Node features (test runner) rely on this runtime.

Other files of interest for Copilot to consult: README.md, AGENT_SPEC.md, src/**, tests/**, package.json, tsconfig.json.

If you want this file expanded (examples for common edit flows, patterns for adding new tools, or test-run helpers), say which area to extend.
