# Version 1 Integrated Completion Specification

**Product:** `getit` — Man-in-the-Loop (MITL) Terminal Workspace Agent  
**Version:** `1.0.0`  
**Status:** Source of truth for v1 build completion  
**Supersedes:** Use this document as the integrated authority; `AGENT_SPEC.md`, `PHASE2.MD`, and `PHASE3.md` remain historical phase plans.

---

## 0. Purpose and Scope

This specification defines **Version 1 integrated completion**: the minimum shippable product where foundation stages, Phase 2 execution kernel, Phase 3 workspace subsystem, and post-Phase-3 integrations work as one coherent system.

**In scope for v1:**

- Secure, typed tool execution with MITL approval
- Multi-turn REPL agent with environment discovery
- Async execution, policy engine, secret scrubbing, ledger undo
- Local-first workspace manifest, scrubbed shadow tracking, drift detection
- Interactive drift resolution with optional AI advisory
- Shadow history browsing and commit-targeted workspace rollback
- Deterministic dependency healer and remote sync via `gh`
- Setup wizard and multi-carrier API configuration
- Centered terminal UI cards for all user-facing confirmations

**Explicitly out of scope for v1 (deferred):**
- Custom Git networking inside `getit` (must use `gh` only)
- Runtime npm dependencies (zero production dependencies is mandatory)
- Automatic execution of remediation or rollback without MITL
- Cloud-hosted agent runtime or web UI

---

## 1. Product Definition

### 1.1 One-Sentence Definition

`getit` is a zero-dependency Node.js CLI that supervises LLM-proposed shell and file operations behind layered security gates, maintains scrubbed local workspace state for configuration drift, and requires explicit human approval before every mutation.

### 1.2 Primary User Journeys (v1 Complete When All Pass)

| ID | Journey | Success Condition |
|----|---------|-------------------|
| J-01 | First-time setup | `getit --setup` or missing-key REPL launch runs wizard; writes `.getitrc`; subsequent `getit` starts REPL |
| J-02 | Install software via NL | One-shot `getit "install ripgrep"` discovers platform, proposes `apt-get`/`brew`/etc., MITL approves, command runs async |
| J-03 | Patch config safely | Agent proposes `manage_file` patch; colored diff + MITL card; snapshot taken; `getit undo` restores |
| J-04 | Initialize workspace | `getit manifest init` writes `.getit-manifest.json` with metadata only; dashboard shows tracked state |
| J-05 | Detect and resolve drift | `getit status` reports drift; `getit resolve` walks files with diff, optional AI advisory, stages to shadow repo |
| J-06 | Roll back workspace | `getit history` lists shadow commits; `getit rollback <hash>` previews scrubbed diff, MITL confirms, live + manifest sync |
| J-07 | Sync dotfiles remotely | `getit status --remote` reports; `/sync` or remote push path runs pre-push secret scan; fails closed on auth/network errors |
| J-08 | Recover from bad command | Non-zero exit halts turn; healer may propose fix; user approves separately; no auto-retry without approval |

### 1.3 Non-Negotiable Architectural Laws

1. **Structured tools only** — LLM output is limited to JSON tool calls (`execute_bash`, `manage_file`). No raw shell strings from the model bypass the interceptor.
2. **Fail-closed execution** — Non-zero child exit codes halt the agent turn until the user sends a new prompt.
3. **Absolute path resolution** — All file operations resolve `~`, symlinks, and relative paths before policy checks.
4. **Secrets never leave scrubbed** — Tracking mirror, rollback previews, drift hashes, and model history use scrubbed or redacted content.
5. **MITL on every mutation** — Bash, file create/patch, healer remediation, rollback, dry-run roadmap batch, and mixed undo confirmations require `[Y/n/e]` or explicit `y`.
6. **Zero runtime dependencies** — Only Node.js ≥20 built-ins and devDependencies for TypeScript build.

---

## 2. System Architecture

### 2.1 Layered Stack

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                         User Interface Layer                            │
│  REPL slash commands • CLI subcommands • Centered ANSI cards (layout.ts)│
└───────────────────────────────────┬─────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      Agent Orchestration (agent/)                       │
│  AgentLoop • buildSystemPrompt • sendChatRequest • toolSchemas          │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Tool Interceptor & Dispatch (tools/)                 │
│  registry • execute-bash • manage-file • diff preview                   │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      MITL Gate (mitl/interceptor.ts)                    │
│  BASH | FILE CREATE | FILE PATCH • [Y/n/e] • edit-before-run            │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   Security Pipeline (security/)                         │
│  path-policy • policy/.getitignore • input-sanitizer • scrubber • env   │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   Execution Kernel (execution/ + backup/)               │
│  async spawn • log truncation • ledger snapshots • getit undo           │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   Workspace Subsystem (workspace/)                        │
│  manifest • boundary • tracking • drift • healer • remote               │
│  history • rollback • drift-advisor • resolve flow (index.ts)         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 State Storage Map

| Location | Purpose | Written By |
|----------|---------|------------|
| `<workspace>/.getit-manifest.json` | Metadata-only tracked file registry | `manifest.ts`, resolve/rollback flows |
| `$GETIT_BACKUP_ROOT` or `~/.local/state/getit/tracking/` | Scrubbed shadow Git repo | `tracking.ts` |
| `$GETIT_BACKUP_ROOT` or `~/.local/state/getit/backup/` | Per-transaction file snapshots + JSON ledger | `shadow-store.ts`, `ledger.ts` |
| `~/.config/getit/policy.json` | Global path policy rules | User / wizard |
| `<project>/.getitignore` | Project path deny patterns | User |
| `.getitrc` / `.env` (project or home) | API carrier, model, timeout, profile | `secrets-loader.ts`, wizard |
| `GETIT_TEST_MODE=true` | Bypass MITL prompts in tests | Test harness only |

### 2.3 Environment Variables

| Variable | Required | Behavior |
|----------|----------|----------|
| `OPENROUTER_API_KEY` / `GETIT_API_KEY` | For cloud carriers | Loaded via `loadConfig()`; scrubbed from child env |
| `GETIT_BACKUP_ROOT` | No | Overrides default `~/.local/state/getit` roots |
| `GETIT_TEST_MODE` | No | When `true`, auto-confirms rollback MITL |
| `MOCK_TOOL_CALL` | No | Stage 1 test: runs single MITL mock |
| `GITHUB_TOKEN` | No | Stripped from child process environment |

---

## 3. Foundation: Four Stages (v1 Baseline)

These capabilities are **already required** for v1; they are not optional add-ons.

### 3.1 Stage 1 — MITL Interceptor Gate

**Module:** `src/mitl/interceptor.ts`

| Requirement | Detail |
|-------------|--------|
| Tool types | `BASH`, `FILE CREATE`, `FILE PATCH` |
| Prompt | Centered `Approve command? [Y/n/e] ❯` |
| `Y` / Enter | Approve payload as shown |
| `n` | Deny; return `Execution denied by user.` to agent history |
| `e` | Allow inline edit of command/payload before execution |
| Warnings | Display sanitization warnings (cascades, redirects, subshells) above card |

**Acceptance:** `STG1_001` — Mock path with `MOCK_TOOL_CALL=true` exits 0 after approval flow.  
**Tests:** `tests/stage1.test.ts`

### 3.2 Stage 2 — Ambient Environment Discovery

**Module:** `src/discovery/environment.ts`

| Field | Source |
|-------|--------|
| `arch` | Normalized CPU arch (`x86_64`, `arm64`) |
| `osName` / `targetPlatform` | `os.platform()` mapped to Debian/macOS/Fedora/Arch families |
| `binaries` | Presence of `curl`, `tar`, `unzip`, detected package manager |
| `localBinInPath` | Whether `~/.local/bin` is in `$PATH` |
| `primaryPackageManager` | `apt-get`, `brew`, `dnf`, or `pacman` |

Discovery output is injected into the system prompt on every session via `buildSystemPrompt()`.

**Acceptance:** `STG2_001` — Prompt context contains architecture and dependency flags.  
**Tests:** `tests/stage2.test.ts`, `tests/functionality.test.ts`

### 3.3 Stage 3 — Persistent REPL Shell

**Module:** `src/agent/loop.ts`, `src/index.ts`

| Requirement | Detail |
|-------------|--------|
| Prompt | Centered `getit-agent ❯ ` |
| Multi-turn | Conversation history retained until `/reset` |
| Exit | `exit`, `/exit`, `/quit`, Ctrl+C, EOF |
| Stateful CWD | `/cd <path>` updates `execute-bash` working directory |
| Fail-closed | Tool failure sets halt flag; next user message required |

**Acceptance:** `STG3_001` — Two-turn context retention without crash.  
**Tests:** `tests/stage3.test.ts`

### 3.4 Stage 4 — Unified ANSI Diff Patching

**Module:** `src/tools/diff.ts`, `src/tools/manage-file.ts`

| Requirement | Detail |
|-------------|--------|
| Algorithm | LCS-based unified diff |
| Colors | Deletions `\x1b[31m-`, additions `\x1b[32m+` |
| When shown | Before MITL on `patch` and in workspace resolve/rollback previews |

**Acceptance:** `STG4_001` — Diff output contains red removals and green additions.  
**Tests:** `tests/stage4.test.ts`

---

## 4. Phase 2 Execution Kernel (v1 Required)

### 4.1 Module A — Asynchronous Process Kernel

**Modules:** `src/execution/async-process.ts`, `src/execution/log-buffer.ts`, `src/tools/execute-bash.ts`

| ID | Criterion |
|----|-----------|
| ASYNCH_001 | Long-running commands stream stdout/stderr without blocking REPL input handling |
| ASYNCH_002 | stderr captured and included in truncation pipeline |
| ASYNCH_003 | Logs > ~2000 tokens truncated to head + marker + tail before model history |

Default shell: `/bin/bash`. Default timeout configurable via `--timeout` or `.getitrc`.

**Tests:** `tests/phase2-async.test.ts`

### 4.2 Module B — Ledger-Backed Undo (Transaction Scope)

**Modules:** `src/backup/shadow-store.ts`, `src/backup/ledger.ts`

| ID | Criterion |
|----|-----------|
| ROLL_001 | Every `file_create` / `file_patch` snapshots original bytes before write |
| ROLL_002 | `getit undo` and `/undo` restore latest transaction batch |
| ROLL_003 | Mixed batches (files + commands) prompt user before partial restore |

**Commands:** `getit undo`, REPL `/undo`

**Tests:** `tests/phase2-backup.test.ts`

> **Distinction:** Ledger undo restores **agent session file mutations**. Workspace rollback (Section 6.5) restores **tracked configuration state** from the shadow Git repo. Both coexist in v1.

### 4.3 Module C — Policy-Driven Protection

**Modules:** `src/security/policy.ts`, `src/security/path-policy.ts`, `.getitignore`

| Profile | Behavior |
|---------|----------|
| `strict` | Default bans + `.getitignore` + global policy; most restrictive |
| `normal` | Base bans; localized credential paths may proceed with MITL |
| `override` | User whitelist patterns in global policy only |

| ID | Criterion |
|----|-----------|
| POL_001 | `.getitignore` glob blocks read/write on matched paths |
| POL_002 | `~/.config/getit/policy.json` applies from any cwd |
| POL_003 | Symlink traversal into banned paths is blocked |

**CLI:** `--profile <strict|normal|override>`, REPL `/policy`

**Tests:** `tests/phase2-policy.test.ts`, `tests/safety.test.ts`

### 4.4 Module D — Shannon Entropy Scrubbing

**Module:** `src/security/scrubber.ts`

| ID | Criterion |
|----|-----------|
| SCRUB_001 | High-entropy and known-pattern secrets become `[REDACTED_N]` consistently per session |
| SCRUB_002 | Same secret → same placeholder index within a masking session |
| SCRUB_003 | Bash commands scanned pre-MITL; warnings if raw secrets detected |

Normalization for hashing: `[REDACTED_N]` → `[REDACTED_SECRET]` before SHA-256 in `computeScrubbedHash()`.

**Tests:** `tests/phase2-scrub.test.ts`, `tests/phase3-drift.test.ts`

### 4.5 Module E — Cross-Platform Discovery

**Module:** `src/discovery/environment.ts`

| ID | Criterion |
|----|-----------|
| PLAT_001 | Linux Debian/Ubuntu → `apt-get` remediation templates |
| PLAT_002 | macOS → `brew` templates |
| PLAT_003 | Fedora/RHEL → `dnf`; Arch → `pacman` |

**Tests:** `tests/phase2-platform.test.ts`

### 4.6 Module F — Plan-Ahead Dry-Run

**Modules:** `src/planning/plan-queue.ts`, `src/runtime/session.ts`

| ID | Criterion |
|----|-----------|
| PLAN_001 | `--dry-run` queues mutating tool calls without executing |
| PLAN_002 | Roadmap rendered; user batch-approves with single `[y/N]` |
| PLAN_003 | REPL `/dry-run on|off` toggles session flag |

**Tests:** `tests/phase2-plan.test.ts`

---

## 5. Phase 3 Workspace Subsystem (v1 Required)

### 5.1 Module A — Workspace Manifest & Boundary

**Modules:** `src/workspace/manifest.ts`, `src/workspace/boundary.ts`

#### Manifest schema (`.getit-manifest.json`)

```typescript
interface TrackedPathMetadata {
  hash: string;      // SHA-256 of scrubbed-normalized content
  mode: number;      // fs stat mode
  mtime: number;     // ms since epoch
}

interface WorkspaceManifest {
  fingerprint: string;   // sha256(hostname + platform + arch)
  initializedAt: string; // ISO-8601
  platform: string;
  arch: string;
  packageManager: string;
  trackedPaths: Record<string, TrackedPathMetadata>;
}
```

**Rules:**

- **Metadata only** — Never serialize raw file buffers into manifest JSON.
- **Init candidates** — `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `.nvmrc`, `.getitignore`, `.env`, `.gitignore`, `README.md` (if present at init).

#### Boundary enforcement

When `findWorkspaceRoot()` returns a root, `path-policy.ts` injects workspace boundary checks via `isPathInWorkspace()`:

- Allow paths inside workspace root
- Allow `~/.config/getit/**`
- Allow `GETIT_BACKUP_ROOT` / default state dir
- Allow home dotfiles matching allowlist rules in `boundary.ts`

| ID | Criterion |
|----|-----------|
| WKS_001 | `getit manifest init` fingerprints host and writes valid manifest with zero file contents embedded |
| WKS_002 | Writes outside workspace root blocked unless allowlisted |

**Commands:** `getit manifest init`

**Tests:** `tests/phase3-workspace.test.ts`

**Profile routing:** `common/` and `profiles/<fingerprint>/` created on init; config files under these paths are tracked and included in drift scans (`src/workspace/profiles.ts`).

### 5.2 Module B — Scrubbed Tracking Repository

**Module:** `src/workspace/tracking.ts`

| Step | Action |
|------|--------|
| 1 | Resolve live file under workspace root |
| 2 | `scrubContentGeneric()` via `scrubText()` |
| 3 | Write scrubbed copy to shadow repo under `GETIT_BACKUP_ROOT/tracking` |
| 4 | `git add` + `git commit` with descriptive message |

| ID | Criterion |
|----|-----------|
| TRK_001 | API key in live file appears as `[REDACTED_N]` only in tracking mirror |
| TRK_002 | Live file on disk remains unredacted |

**Commands:** `getit inspect <path>`, `getit export [dir]`, implicit via `stage` / `resolve`

**Tests:** `tests/phase3-drift.test.ts`, `tests/phase3-workspace.test.ts`, `tests/phase3-export.test.ts`

### 5.3 Module C — Offline Drift Detection

**Module:** `src/workspace/drift.ts`

| Status | Meaning |
|--------|---------|
| `unmodified` | Live scrubbed hash matches manifest |
| `modified` | Hash mismatch (drift) |
| `untracked` | File exists in workspace candidates, not in manifest |
| `missing` | In manifest, absent on disk |

| ID | Criterion |
|----|-----------|
| DRF_001 | Single-byte change → `modified` |
| DRF_002 | ≤1000 tracked files: status completes in <1s on typical dev hardware (batched async hashing) |

**Commands:** `getit status`, REPL `/status`

**Tests:** `tests/phase3-drift.test.ts`

### 5.4 Module D — Deterministic Dependency Healer

**Module:** `src/workspace/healer.ts`, integrated in `execute-bash.ts`

| ID | Criterion |
|----|-----------|
| HEAL_001 | Known stderr patterns map to exact package-manager install command |
| HEAL_002 | Remediation presented via second MITL call; never auto-executed |
| HEAL_003 | Non-matching errors append `[Healer Note: ...]` diagnostic only |

**Tests:** `tests/phase3-healer.test.ts`, `tests/phase3-synergies.test.ts`

### 5.5 Module E — Remote GitHub Synchronization

**Module:** `src/workspace/remote.ts`

| ID | Criterion |
|----|-----------|
| REM_001 | `scanForSecrets()` aborts push/sync if high-entropy content detected in outgoing tree |
| REM_002 | `checkRemoteStatus()` catches missing/unauthenticated `gh`; returns error without corrupting manifest |
| REM_003 | Network failure does not mutate local manifest or ledger |

**Commands:** `getit status --remote`, REPL `/sync`

**Tests:** `tests/phase3-remote.test.ts`

Transport **must** use local `gh` CLI only. No embedded Git HTTP credentials in `getit`.

---

## 6. v1 Integration Layer (Post-Phase-3)

These modules complete the **integrated** product beyond the original PHASE3.md scope.

### 6.1 Interactive Drift Resolution

**Entry:** `getit resolve`, `getit stage` (alias), REPL `/resolve`, `/stage`  
**Implementation:** `runWorkspaceResolve()` in `src/index.ts`

#### Per-file flow

| Status | UI | User action on `y` |
|--------|-----|-------------------|
| `modified` | Scrubbed unified diff + AI Drift Advisory card | `stageToTracking()`, update manifest hash/mode/mtime |
| `untracked` | Scrubbed content preview + advisory | Start tracking + manifest entry |
| `missing` | Prompt only (no advisory) | Remove manifest entry, delete mirror, `git rm` + commit in shadow |

Default answer is **No** (`[y/N]`).

### 6.2 AI Drift Advisory (Optional LLM)

**Module:** `src/workspace/drift-advisor.ts`

| Requirement | Detail |
|-------------|--------|
| Trigger | Only during `resolve` for `modified` and `untracked` files |
| Input | Scrubbed content + diff text (never raw secrets) |
| Output | 2–3 bullet points; no conversational filler |
| Failure | Returns bullet with error message; resolve flow continues |
| Persona | System prompt identifies advisor as "Jules" architect |

**Acceptance:** `ADV_001` — Advisor receives only scrubbed payloads.  
**Acceptance:** `ADV_002` — API failure does not abort resolve loop.

**Tests:** Covered indirectly via UI/integration; no network in CI by default.

### 6.3 Workspace Shadow History

**Module:** `src/workspace/history.ts`

| Requirement | Detail |
|-------------|--------|
| Source | `git log` on tracking repo |
| Format | Centered cyan card `WORKSPACE SHADOW HISTORY` |
| Empty state | "No shadow history found." |

**Commands:** `getit history`, `getit log`, REPL `/history`, `/log`

| ID | Criterion |
|----|-----------|
| HIST_001 | After staging commit, `getHistory()` returns hash, author, date, message |
| HIST_002 | `renderHistory()` includes commit hash bracket and message text |

**Tests:** `tests/phase3-history-rollback.test.ts`

### 6.4 Workspace Rollback (Shadow Commit → Live)

**Module:** `src/workspace/rollback.ts`

| Phase | Behavior |
|-------|----------|
| Preview | `previewRollback(hash, file?)` — scrubbed unified diff, live vs commit |
| Confirm | Red warning card; `[y/N]` unless `GETIT_TEST_MODE` |
| Execute | Overwrite live files from `git show`; update manifest hashes; sync shadow repo; recovery commit |

| ID | Criterion |
|----|-----------|
| RBK_001 | Rollback restores live file bytes to shadow commit version |
| RBK_002 | Manifest `trackedPaths` hashes match post-rollback scrubbed content |
| RBK_003 | `assertPathAllowed()` rejects paths outside workspace (Security Exception) |
| RBK_004 | Single-file rollback via optional `file` argument |

**Commands:** `getit rollback <hash> [file]`, REPL `/rollback <hash> [file]`

**Tests:** `tests/phase3-history-rollback.test.ts`

### 6.5 Setup Wizard & Multi-Carrier LLM Layer

**Modules:** `src/carriers/registry.ts`, `src/carriers/transport.ts`, `src/carriers/models.ts`, `src/carriers/doctor.ts`, `src/carriers/session.ts`, `src/setup/wizard.ts`, `src/security/secrets-loader.ts`, `src/agent/client.ts`

**Supported carriers:** `openrouter`, `openai`, `anthropic`, `google`, `groq`, `deepseek`, `together`, `mistral`, `azure`, `ollama`, `custom`

| Config key | Purpose |
|------------|---------|
| `GETIT_CARRIER` | Registry carrier id |
| `GETIT_API_KEY` | Primary API secret |
| `GETIT_BASE_URL` | Override preset endpoint |
| `GETIT_MODEL` | Default model |
| `GETIT_AZURE_RESOURCE` / `GETIT_AZURE_DEPLOYMENT` | Azure OpenAI routing |

Wizard steps: pick carrier preset → API key (skip if keyless) → endpoint (azure/custom) → connection test → model discovery → safety → persist.

| ID | Criterion |
|----|-----------|
| WIZ_001 | `getit --setup` exits 0 with config file written |
| WIZ_002 | Known API key registered via `registerKnownSecret()` for consistent scrubbing |
| CAR_001 | `getit config` and `/config` show carrier, URL, model, tools support |
| CAR_002 | `/carrier <id>` switches provider in-process |
| CAR_003 | `getit models` and `/models` list models from carrier API |
| CAR_004 | `getit doctor` reports carrier connectivity |
| CAR_005 | Ollama (`auth: none`) runs without API key |

**Tests:** `tests/phase3-config.test.ts`, `tests/carriers-registry.test.ts`, `tests/carriers-transport.test.ts`

### 6.6 Terminal Layout System

**Module:** `src/ui/layout.ts`

All user-facing cards (MITL, help, config, history, rollback warning, drift advisory, wizard) use:

- `getTerminalWidth()`, `centerBlock()`, `centerLine()`, `centerPrompt()`
- Standard inner width **58** columns for bordered cards
- `stripAnsi()` for padding calculations

| ID | Criterion |
|----|-----------|
| UI_001 | Help and history cards render without throwing when stdout is TTY |
| UI_002 | Prompts align to terminal center |

**Tests:** `tests/phase3-ui.test.ts`

---

## 7. Complete CLI & REPL Surface (v1)

### 7.1 Global Flags

| Flag | Effect |
|------|--------|
| `-h, --help` | Usage text |
| `-v, --version` | Print semver from nearest `package.json` |
| `--model <id>` | Override LLM model |
| `--timeout <ms>` | Bash spawn timeout |
| `--dry-run` | Queue mutations only |
| `--profile strict\|normal\|override` | Policy profile |
| `--allow-root` | Bypass root UID guard |
| `--setup` | Run wizard and exit |

**Root guard:** UID 0 exits unless `--allow-root` or test env flags set.

### 7.2 Positional CLI Commands

| Command | Args | Exits | Notes |
|---------|------|-------|-------|
| `(default)` | `[prompt...]` | After one-shot | Requires API key unless custom carrier |
| `undo` | — | 0/1 | Ledger restore |
| `manifest` | `init` | 0/1 | Initialize workspace |
| `status` | `[--remote]` | 0/1 | Drift table + optional remote |
| `inspect` | `<path>` | 0/1 | Scrubbed mirror dump |
| `export` | `[output-dir]` | 0/1 | Bulk scrubbed export of tracked files |
| `resolve` / `stage` | — | 0/1 | Interactive drift resolution |
| `history` / `log` | — | 0/1 | Shadow commit card |
| `rollback` | `<hash> [file]` | 0/1 | Preview + execute |
| `config` | — | 0/1 | Show runtime carrier/model options |
| `doctor` | — | 0/1 | Health checks |
| `models` | — | 0/1 | List models for active carrier |

### 7.3 REPL Slash Commands

| Command | Function |
|---------|----------|
| `/help` | Command table card |
| `/exit`, `/quit` | End session |
| `/clear` | ANSI clear screen |
| `/env` | Environment dashboard |
| `/reset` | Clear agent conversation |
| `/cd <path>` | Change active cwd |
| `/carrier [id]` | Show or switch LLM provider |
| `/models [refresh]` | List models for active carrier |
| `/model [name]` | Get/set model |
| `/setup` | Run configuration wizard |
| `/config` | Runtime options card |
| `/policy` | Show active profile |
| `/dry-run on\|off` | Toggle dry-run |
| `/undo` | Ledger undo |
| `/status` | Workspace drift (cwd-based) |
| `/resolve`, `/stage` | Interactive drift resolve |
| `/sync` | `syncWithRemote()` |
| `/export [dir]` | Scrubbed export of tracked files |
| `/history`, `/log` | Shadow history card |
| `/rollback <hash> [file]` | Preview + rollback |

Unrecognized slash commands print hint to `/help`.

### 7.4 Agent Tools (LLM Schema)

| Tool | Actions | Policy |
|------|---------|--------|
| `execute_bash` | `command`, optional `working_directory` | Sanitize → scrub → MITL → async spawn → healer on failure |
| `manage_file` | `read`, `create`, `patch` | Path policy → diff on patch → snapshot → MITL → atomic write |

---

## 8. Security Invariants (v1 Checklist)

Every release candidate must satisfy:

- [ ] **S-01** No tool executes without MITL approval (except `GETIT_TEST_MODE` rollback confirm)
- [ ] **S-02** `OPENROUTER_API_KEY`, `GITHUB_TOKEN` stripped from child `env`
- [ ] **S-03** Banned prefixes: `~/.ssh`, `/etc`, `/boot`, `/dev`, workspace escape without allowlist
- [ ] **S-04** Bash cascades (`&&`, `||`, `;`), redirects, subshells flagged before approval
- [ ] **S-05** Pre-push secret scan blocks remote sync on credential detection
- [ ] **S-06** Drift advisor and model history never receive unscrubbed high-entropy secrets
- [ ] **S-07** Running as root blocked by default
- [ ] **S-08** Fail-closed on non-zero exit — no automatic agent retry

---

## 9. Test Matrix (v1 Definition of Done)

All tests run via:

```bash
npm test   # tsc && node --test dist/tests/*.test.js
```

**Minimum:** 94 tests, 0 failures (current baseline).

| Suite | File | Covers |
|-------|------|--------|
| Functionality | `functionality.test.ts` | Discovery, diff, paths, secrets loader |
| Safety | `safety.test.ts` | Path traversal, banned paths, sanitization |
| Stages 1–4 | `stage*.test.ts` | MITL, discovery, REPL, diff colors |
| Phase 2 | `phase2-*.test.ts` | Async, backup, policy, scrub, platform, plan |
| Phase 3 core | `phase3-workspace.test.ts`, `phase3-drift.test.ts`, `phase3-healer.test.ts`, `phase3-remote.test.ts` | Manifest, drift, healer, remote |
| Phase 3 integration | `phase3-config.test.ts`, `phase3-ui.test.ts`, `phase3-synergies.test.ts` | Wizard, layout, cross-module |
| Phase 3 history | `phase3-history-rollback.test.ts` | History parsing, rollback, boundary |
| Phase 3 export | `phase3-export.test.ts` | Scrubbed bulk export |
| Phase 3 manifest | `phase3-manifest.test.ts` | WKS_001, WKS_002 |
| Phase 3 profiles | `phase3-profiles.test.ts` | Profile layout and tracking |
| Multi-carrier | `carriers-registry.test.ts`, `carriers-transport.test.ts` | Presets, headers, keyless |

### 9.1 Required CI Gate

| Gate | Command | Pass condition |
|------|---------|----------------|
| Build | `npm run build` | `tsc` exit 0 |
| Test | `npm test` | All tests pass |
| Lint | — | No dedicated linter configured in v1 |

---

## 10. v1 Completion Status Matrix

| Component | Spec ID | Implementation | Tests |
|-----------|---------|----------------|-------|
| MITL interceptor | STG1 | ✅ `mitl/interceptor.ts` | ✅ |
| Environment discovery | STG2 | ✅ | ✅ |
| REPL loop | STG3 | ✅ | ✅ |
| ANSI diff | STG4 | ✅ | ✅ |
| Async execution | ASYNCH | ✅ | ✅ |
| Ledger undo | ROLL | ✅ | ✅ |
| Policy engine | POL | ✅ | ✅ |
| Entropy scrubber | SCRUB | ✅ | ✅ |
| Cross-platform | PLAT | ✅ | ✅ |
| Dry-run planner | PLAN | ✅ | ✅ |
| Manifest + boundary | WKS | ✅ | ✅ |
| Scrubbed tracking | TRK | ✅ | ✅ |
| Drift detection | DRF | ✅ | ✅ |
| Dependency healer | HEAL | ✅ | ✅ |
| Remote sync | REM | ✅ | ✅ |
| Interactive resolve | — | ✅ `index.ts` | Partial (manual) |
| Drift advisor | ADV | ✅ | Network optional |
| Shadow history | HIST | ✅ | ✅ |
| Workspace rollback | RBK | ✅ | ✅ |
| Setup wizard | WIZ | ✅ | ✅ |
| Centered UI | UI | ✅ | ✅ |
| Multi-carrier registry | CAR | ✅ `carriers/registry.ts` | ✅ |
| OpenAI-compat transport | CAR | ✅ `carriers/transport.ts` | ✅ |
| Model discovery | CAR_003 | ✅ `carriers/models.ts` | ✅ |
| Setup wizard v2 | WIZ | ✅ `setup/wizard.ts` | ✅ |
| `getit config` / `doctor` | CAR | ✅ `index.ts` | ✅ |
| `getit export` | TRK | ✅ `workspace/export.ts` | ✅ |
| Profile routing dirs | WKS | ✅ `workspace/profiles.ts` | ✅ |
| Async drift hashing | DRF_002 | ✅ `workspace/drift.ts` | ✅ |
| Manifest split tests | WKS | ✅ `phase3-manifest.test.ts` | ✅ |

---

## 11. Version 1 Definition of Done

`getit` v1 is **complete** when all of the following are true:

### 11.1 Functional

1. All eight user journeys (Section 1.2) are executable on a clean Debian or macOS machine with only Node ≥20, `git`, and optionally `gh` installed.
2. Every CLI and REPL command in Section 7 is documented in `--help` and behaves as specified.
3. Workspace lifecycle works end-to-end: `manifest init` → edit files → `status` → `resolve` → `history` → `rollback` → optional `status --remote` / `/sync`.
4. Agent path works end-to-end: REPL prompt → tool proposal → diff (if patch) → MITL → execution → optional `undo`.
5. Healer proposes fixes only through MITL; fail-closed turn halt preserved.

### 11.2 Security

6. All invariants S-01 through S-08 verified by `safety.test.ts` and phase2/phase3 security tests.
7. No production `dependencies` in `package.json`.

### 11.3 Quality

8. `npm test` reports ≥112 passing tests, 0 failures.
9. `README.md` usage section matches Section 7 command surface.
10. Post-v1 items (Section 13) documented and not claimed as shipped.

### 11.4 Documentation

11. This file (`finalphase.md`) is the authoritative integration spec for v1.
12. Phase documents retained as historical traceability only.

---

## 12. Implementation Notes for Builders

1. **Reuse security primitives** — Always call `assertPathAllowed()`, `scrubText()` / `scrubContentGeneric()`, and `computeScrubbedHash()`; do not duplicate logic.
2. **Two undo systems** — Communicate clearly to users: `getit undo` = last agent file transaction; `getit rollback` = workspace shadow Git commit.
3. **Test mode** — `GETIT_TEST_MODE=true` auto-confirms rollback only; MITL still applies elsewhere unless mock env set.
4. **Adding healing rules** — Extend `HealingRule[]` in `healer.ts`; keep remediation commands deterministic per `primaryPackageManager`.
5. **Adding manifest candidates** — Update `candidates` array in `initWorkspaceManifest()` and drift candidate scan in `drift.ts` together.
6. **Performance** — Drift hashing must remain batched/async for large manifests; do not switch to synchronous full-tree reads on main thread.

---

## 13. Future Work (Post-v1, Not Blocking)

| Feature | Rationale |
|---------|-----------|
| Progress bars on async spawn | UX enhancement beyond v1 ASYNCH_001 |
| npm publish pipeline | Distribution outside local `npm link` |
| Deep profile merge rules | Overlay precedence when common/ and profiles/ both define the same logical key |

---

## 14. Document Control

| Field | Value |
|-------|-------|
| Created | 2026-05-21 |
| Package version | 1.0.0 |
| Repository | `installer2` / published as `getit` |
| Authoritative for | v1 integrated completion |
| Related specs | `AGENT_SPEC.md`, `PHASE2.MD`, `PHASE3.md` |

When implementing changes, update the **Status Matrix (Section 10)** and **Definition of Done (Section 11)** in the same PR that completes a deferred item.
