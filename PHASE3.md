# Phase 3 Engineering Plan & Source of Truth: Local-First Workspace Agent

This document serves as the absolute specification, execution blueprint, and source of truth for implementing the **Phase 3 Upgrades** for the `getit` Workspace Agent.

## 1. System Context & Architectural Alignment

Phase 2 established `getit` as a highly performant, enterprise-safe ecosystem with asynchronous streaming, rigorous policy enforcement (`.getitignore`), Shannon entropy secret scrubbing, and Git-backed rollback mechanisms.

Phase 3 transitions `getit` from a reactive, stateless command runner into a **deterministic, state-aware workspace manager**. It introduces a persistent local state layer that tracks dotfiles, monitors system drift, and synchronizes configurations securely.

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        Phase 2 Execution Kernel                        │
│  (Async Spawn, Token Scrubbing, Policy Engine, Shadow Store Undo)      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    ▼  [Extended into]
┌────────────────────────────────────────────────────────────────────────┐
│                        Phase 3 Workspace Subsystem                     │
│                                                                        │
│  ┌────────────────────────┐ ┌────────────────────────┐ ┌────────────┐  │
│  │ Workspace Manifest &   │ │ Scrubbed Tracking      │ │ Rule-Based │  │
│  │ Boundary Enforcement   │ │ Repository (Git)       │ │ Healer     │  │
│  └───────────┬────────────┘ └───────────┬────────────┘ └──────┬─────┘  │
│              ▼                          ▼                     ▼        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Offline Drift Detection & Remote GitHub Sync (gh CLI)            │  │
│  │ - Constant Validation Against the Manifest Source of Truth       │  │
│  │ - Secret-Free Remote Syncing                                     │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

## 2. Core Modules & Phase 3 Technical Specifications

### Module A: Workspace Manifest & Boundary Enforcement (`src/workspace/manifest.ts`)

#### 1. Context & Rationale
Currently, `getit` operates anywhere in the filesystem subject only to global bans. To manage environments reproducibly, `getit` needs a defined workspace root and a cryptographically hashed manifest acting as the source of truth for tracked files, machine fingerprints, and active profiles.

#### 2. Implementation Requirements
* **Manifest Initialization:** Implement `getit manifest init`. This discovers common ecosystem markers (e.g., `package.json`, `Cargo.toml`, `pyproject.toml`, `.nvmrc`) and generates a metadata-only `manifest.json`.
* **Metadata-Only Tracking:** The manifest must exclusively store metadata: relative file paths, SHA-256 hashes of scrubbed content, file modes, timestamps, and the machine fingerprint. **Never** store raw file contents in the manifest.
* **Workspace Boundary:** Establish `src/workspace/boundary.ts`. When a workspace is active, `path-policy.ts` must dynamically inject a rule that restricts unbounded upward traversal outside the workspace root, unless explicitly targeting global `~/.config` or dotfiles via an allowlist.
* **Profile Routing:** Support a shared `common/` base and machine-specific `profiles/<fingerprint>/` directories for configuration divergence.

#### 3. Strict Acceptance Criteria
* **WKS_001:** `manifest init` must accurately fingerprint the host machine and generate a valid JSON manifest without storing any file contents.
* **WKS_002:** Operations performed while inside a workspace must be blocked by the policy engine if they attempt to write outside the workspace boundary, unless specifically allowlisted.

---

### Module B: Scrubbed Tracking Repository (`src/workspace/tracking.ts`)

#### 1. Context & Rationale
To sync dotfiles and configurations remotely, they must be tracked locally in a Git repository. However, raw configurations often contain inline secrets. The tracking repository must be a *scrubbed mirror* of the live files.

#### 2. Implementation Requirements
* **Tracking Layer:** Implement an internal git-backed tracking directory (e.g., `~/.local/state/getit/tracking/`).
* **Pre-Stage Scrubbing Pipeline:** Before a file is copied from the live system into the tracking repository, it must pass through `src/security/scrubber.ts`. High-entropy strings and known token patterns must be dynamically replaced with deterministic placeholders (e.g., `[REDACTED_API_KEY]`).
* **Safe Export:** Provide `getit inspect` and `getit export` to view the scrubbed contents prior to any commit.

#### 3. Strict Acceptance Criteria
* **TRK_001:** Copying a file containing `sk-abcdef123456...` into the tracking repository must result in the tracking repository exclusively containing the redacted placeholder.
* **TRK_002:** The live operational file must remain untouched and unredacted on the host system; only the tracking mirror is scrubbed.

---

### Module C: Offline Drift Detection & Status (`src/workspace/drift.ts`)

#### 1. Context & Rationale
System configurations drift as developers make manual changes. `getit` must detect when live files diverge from the scrubbed tracking manifest.

#### 2. Implementation Requirements
* **Status Engine:** Implement `getit status` and the `/status` REPL slash command.
* **Hash Comparison:** Compute live SHA-256 hashes (post-scrubbing) of tracked files and compare them against the `manifest.json` state.
* **Drift Reporting:** Categorize and report files as:
  * `Tracked & Unmodified`
  * `Modified` (Drift detected)
  * `Untracked` (Present in workspace, absent from manifest)
  * `Missing` (Present in manifest, absent from filesystem)

#### 3. Strict Acceptance Criteria
* **DRF_001:** `getit status` must accurately report a file as `Modified` if a single byte is changed on disk compared to the manifest hash.
* **DRF_002:** Performance must remain sub-second for workspaces with up to 1,000 tracked files using asynchronous batched file hashing.

---

### Module D: Deterministic Rule-Based Dependency Healing (`src/workspace/healer.ts`)

#### 1. Context & Rationale
When builds fail due to missing dependencies, LLMs can hallucinate incorrect fixes. Phase 3 implements a strictly deterministic, rule-based healer for common dependency failures, keeping the system safe and predictable.

#### 2. Implementation Requirements
* **Regex Rule Engine:** Define a schema of known compilation/execution failures (e.g., `command not found: node`, `missing libssl.so`).
* **Deterministic Matching:** When the async process runner (`executeCommandAsync`) returns a non-zero exit code, scan the `stderr` buffer against the rule engine.
* **MITL Enforcement:** If a rule matches, generate the deterministic fix command (e.g., `apt-get install -y libssl-dev`). **Do not auto-execute.** The proposed fix must be sent to the Phase 2 MITL Interceptor (`presentMITL`) for manual user approval.
* **LLM Bypass:** Dependency healing in Phase 3 is rule-based only. LLM-generated remediation for these specific critical errors is deferred to maintain determinism.

#### 3. Strict Acceptance Criteria
* **HEAL_001:** A known error string in `stderr` must trigger the rule engine and present the exact mapped remediation command to the user.
* **HEAL_002:** The healer must never automatically execute a remediation command without explicit MITL `[Y/n/e]` confirmation.

---

### Module E: Remote GitHub Synchronization (`src/workspace/remote.ts`)

#### 1. Context & Rationale
Once local state is perfectly scrubbed and deterministic, the configuration can be safely synchronized to a remote GitHub repository.

#### 2. Implementation Requirements
* **CLI Integration:** Extend status checks with `getit status --remote`.
* **Air-Gapped Syncing:** Use the local `gh` CLI tool to handle authentication and transport. `getit` itself must not implement custom Git networking protocols or handle raw remote credentials.
* **Pre-Push Validation:** Implement a final fail-safe secret scan before triggering `gh repo sync` or `git push`. If *any* high-entropy block or credential-like string is detected in the outgoing git patch, abort the push and raise a fatal security alert.
* **Fail-Closed Network:** If auth fails or the network is unavailable, `status --remote` must fail closed, returning cached local state without corrupting the manifest or ledger.

#### 3. Strict Acceptance Criteria
* **REM_001:** Attempting to sync a repository containing unscrubbed secrets must trigger the pre-push validation and abort the network request entirely.
* **REM_002:** `getit status --remote` must fail gracefully (catching exceptions) if the `gh` CLI is unauthenticated or missing.

## 3. Implementation Blueprint & Phase 3 Milestone Roadmap

```text
┌────────────────────────────────────────────────────────────────────────┐
│ Phase 3 Implementation Timeline                                        │
├────────────────────────────────────────────────────────────────────────┤
│ Track 1 (3A): Workspace Boundary & Local Manifest Generation           │
│               [Delivers: `manifest init`, `src/workspace/manifest.ts`] │
├────────────────────────────────────────────────────────────────────────┤
│ Track 2 (3B): Scrubbed Tracking Repo & Offline Drift Detection         │
│               [Delivers: `status`, `inspect`, Pre-stage Scrubber]      │
├────────────────────────────────────────────────────────────────────────┤
│ Track 3 (3C): Deterministic Dependency Healer                          │
│               [Delivers: Regex Rule Engine, MITL Fix Proposals]        │
├────────────────────────────────────────────────────────────────────────┤
│ Track 4 (3D): Remote GitHub Sync Integration                           │
│               [Delivers: `status --remote`, Pre-Push Validation]       │
└────────────────────────────────────────────────────────────────────────┘
```

## 4. Prompt Instructions for the Agentic Coding Agent

When acting as the agentic coding agent responsible for writing this system, adhere to these explicit instructions:

1. **Leverage Existing Security Gates:** Do not reinvent path validation or token scrubbing. You MUST use the existing `assertPathAllowed()` from `src/security/path-policy.ts` and `scrubText()` from `src/security/scrubber.ts`.
2. **Metadata Only in JSON:** The `manifest.json` file must be parsed and written using strict TypeScript interfaces. Raw file buffers must never be serialized into this file.
3. **No External Dependencies:** Maintain the **zero runtime dependencies** rule. Hashing must use Node's native `crypto` module. Path matching must use the existing `policy.ts` glob logic or native `path` utilities.

## 5. Comprehensive Acceptance Test Specification Matrix

The test framework must validate these implementation patterns using Node's native test runner.

### Workspace & Manifest Tests (`tests/phase3-manifest.test.ts`)
* **Test Case 1:** `manifest init` writes a valid JSON structure containing expected metadata keys (hash, mode, timestamp) and zero raw file content.
* **Test Case 2:** Workspace boundary rules correctly reject path traversal attempts outside the initialized workspace root.

### Drift Detection & Scrubbing Tests (`tests/phase3-drift.test.ts`)
* **Test Case 1:** Modifying a tracked file triggers a `Modified` drift status during `getit status`.
* **Test Case 2:** A file containing an API key is copied to the tracking repo with the key securely replaced by `[REDACTED_N]`.

### Healer & Remote Sync Tests (`tests/phase3-healer.test.ts` & `phase3-remote.test.ts`)
* **Test Case 1:** Simulating a `command not found` error correctly routes the deterministic fix command to the MITL interceptor.
* **Test Case 2:** Executing `status --remote` without an active network connection fails closed, catching the error and preserving local state.
