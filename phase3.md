# Phase 3 Home Workspace Agent, Local-First

## Summary
Build Phase 3 in two milestones. First, add a deterministic local workspace layer: manifest generation, profile routing, scrubbed dotfiles tracking, offline drift detection, and rule-based dependency healing. Second, add remote GitHub synchronization and `status --remote` checks on top of that same local state model. This keeps the system inspectable, safe, and testable before it touches networked workflows.

## Key Changes
- Add a workspace subsystem under `src/workspace/` for manifest, inspection, packages export, drift detection, and tracking.
- Extend `src/index.ts` with `getit manifest init`, `getit inspect`, `getit status`, `/status`, and `--remote` handling.
- Reuse existing Phase 2 policy, scrubber, and async execution paths so workspace reads, exports, and remediation suggestions inherit the current safety gates.
- Make the manifest the source of truth for tracked files, machine fingerprint, package snapshot location, and profile selection.
- Implement drift detection by comparing live hashes against the manifest and reporting missing, changed, and untracked tracked paths.
- Implement dependency healing as deterministic regex/rule matching only, with MITL confirmation for any proposed fix command.
- Add a scrubbed tracking repo layer for dotfiles and manifests, using redacted content for anything staged or exported for GitHub sync.

## Implementation Order
- Phase 3A: local manifest and profile router.
- Phase 3B: scrubbed tracking repo and drift detection.
- Phase 3C: deterministic dependency healer and MITL wrapping.
- Phase 3D: remote GitHub sync and `status --remote` using `gh`, only after local flows are stable.

## Test Plan
- Verify `manifest init` writes a valid manifest and package snapshot for the detected platform.
- Verify `inspect` detects common workspace markers like `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, and `.nvmrc`.
- Verify `status` reports drift for modified, missing, and untracked tracked files.
- Verify secret scrubbing replaces credential-like content before anything enters the tracking repo or Git stage.
- Verify deterministic healer matches known dependency failures and always routes the suggested fix through MITL.
- Verify `status --remote` fails closed without auth or network and does not corrupt local state history.
- Verify `npm run build` and `npm test` remain green after each milestone.

## Assumptions
- The rollout is local-first, with remote GitHub sync deferred to a second milestone.
- Dependency healing in Phase 3 is rule-based only; LLM-generated remediation is deferred.
- `getit status --remote` will use `gh` CLI behavior and fail closed if auth or connectivity is unavailable.
- The profile layout uses a shared `common/` base and machine-specific `profiles/<fingerprint>/` directories.

## Security Addendum
- Track only an explicit allowlist of file paths and directories. Do not auto-discover and ingest arbitrary home directory content.
- Keep the manifest metadata-only: hashes, modes, timestamps, fingerprints, and tracked-path references only. Do not store raw file contents in the manifest.
- Require a pre-push secret scan for any remote sync path. If a secret, private key block, or credential-like token is found, abort the push and surface the redaction result instead.
- Forbid automatic execution of dependency-healing suggestions. All fixes stay behind MITL confirmation, even when the detector confidence is high.
- Add negative tests for blocked reads of protected paths, blocked commit/push attempts containing secrets, and remote drift checks failing closed on auth or network loss.
