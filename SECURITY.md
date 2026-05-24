# Security Model — getit v1.5.0

> Comprehensive documentation of getit's security architecture, threat model, and mitigation strategies.

---

## Table of Contents

1. [Threat Model](#1-threat-model)
2. [Defense Layers](#2-defense-layers)
3. [Man-in-the-Loop Gate](#3-man-in-the-loop-gate)
4. [Secret Scrubbing](#4-secret-scrubbing)
5. [Path Policy Engine](#5-path-policy-engine)
6. [Input Sanitization](#6-input-sanitization)
7. [Environment Isolation](#7-environment-isolation)
8. [Fail-Closed Execution](#8-fail-closed-execution)
9. [Workspace Security](#9-workspace-security)
10. [Security Profiles](#10-security-profiles)
11. [Reporting Vulnerabilities](#11-reporting-vulnerabilities)

---

## 1. Threat Model

`getit` operates in a high-risk environment: an AI model proposes shell commands and file mutations on a user's live system. The primary threats are:

| Threat | Vector | Severity |
|---|---|---|
| **Unauthorized command execution** | LLM proposes a destructive command | Critical |
| **Secret exfiltration** | API keys leak into LLM context or terminal output | High |
| **Path traversal** | LLM targets sensitive system files (`~/.ssh`, `/etc`) | High |
| **Shell injection** | LLM embeds hidden subshells or cascading commands | High |
| **Runaway execution** | Infinite tool-call loop consumes resources | Medium |
| **Credential exposure in child processes** | API keys inherited by spawned commands | Medium |
| **Configuration drift** | Undetected changes to system config files | Low |

---

## 2. Defense Layers

Every LLM-proposed action passes through three sequential safety layers:

```
┌────────────────────────────────────────────────────────┐
│               LLM Output (Tool Call JSON)              │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│  LAYER 1: Static Analysis & Policy Enforcement         │
│                                                        │
│  • Input sanitizer detects cascades, redirects,        │
│    subshells                                           │
│  • Path policy validates against .getitignore,         │
│    hardcoded bans, global policy.json                  │
│  • Workspace boundary enforcement                      │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│  LAYER 2: Secret Scrubbing                             │
│                                                        │
│  • Known-secret registry (exact match)                 │
│  • Pattern matching (sk-*, ghp_*, AKIA*, Bearer, PEM)  │
│  • Shannon entropy analysis (heuristic catch-all)      │
│  • StreamScrubber for real-time token output            │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│  LAYER 3: Human Approval (MITL Gate)                   │
│                                                        │
│  • ANSI-rendered approval card with full payload        │
│  • Security warnings displayed prominently              │
│  • [Y/n/e/c] interaction with edit and clarify modes    │
│  • Fail-closed: no action without explicit approval     │
└────────────────────────────────────────────────────────┘
```

---

## 3. Man-in-the-Loop Gate

The MITL gate is the final and most important safety barrier. **No action executes without explicit human approval.**

### Approval Flow

1. The LLM requests a tool call (`execute_bash` or `manage_file`)
2. The tool dispatcher constructs a human-readable payload
3. For file patches, a colored unified diff is generated
4. The payload is scrubbed to mask any secrets before display
5. An ANSI-bordered card is rendered showing:
   - The action type (`BASH`, `FILE CREATE`, `FILE PATCH`)
   - The full payload (scrubbed)
   - Any security warnings detected by the input sanitizer
6. The user responds with one of:

| Response | Behavior |
|---|---|
| `Y` / Enter | Execute the action exactly as shown |
| `n` | Deny — the rejection message is fed back to the LLM as context |
| `e` | Edit — the payload is pre-filled into readline for modification before execution |
| `c` | Clarify — pause execution and ask the LLM a follow-up question inline |

### Guarantees

- The MITL gate cannot be bypassed by the LLM
- The only bypass mechanism is `GETIT_TEST_MODE=true` (for automated testing)
- Edit mode uses `rl.write()` to pre-fill the payload, so users can modify a single flag without retyping
- Clarify mode preserves the full conversation context

---

## 4. Secret Scrubbing

### Three-Layer Architecture

#### Layer 1: Known-Secret Registry

At startup, all API keys loaded from `.getitrc` and environment variables are registered via `registerKnownSecret()`. These are masked via exact string match before any other analysis.

#### Layer 2: Pattern Matching

Regular expressions catch well-known secret formats:

| Pattern | Matches |
|---|---|
| `sk-[a-zA-Z0-9]{20,}` | OpenAI API keys |
| `ghp_[a-zA-Z0-9]{36,}` | GitHub personal access tokens |
| `github_pat_[a-zA-Z0-9_]{20,}` | GitHub fine-grained PATs |
| `AKIA[0-9A-Z]{16}` | AWS access key IDs |
| `Bearer [a-zA-Z0-9\-._~+/]+=*` | Bearer tokens |
| `-----BEGIN .* PRIVATE KEY-----` | PEM private keys |

#### Layer 3: Shannon Entropy Analysis

For tokens ≥33 characters that don't match known patterns, Shannon entropy determines if the string is likely a secret:

| Threshold | Value | Target |
|---|---|---|
| `HEX_ENTROPY_THRESHOLD` | 4.5 | Pure hex strings (excluding standard git SHAs) |
| `BASE64_HARD_THRESHOLD` | 5.1 | Base64-like tokens (near-theoretical max) |
| `BASE64_SOFT_THRESHOLD` | 3.7 | Long base64 tokens (≥40 chars, mixed case + digits) |
| `GENERAL_ENTROPY_THRESHOLD` | 4.9 | Mixed-charset tokens |

**False-positive prevention (v1.5 improvements):**
- Standard git SHAs (40/64-char hex) are whitelisted before entropy analysis
- URLs (`http://`, `https://`) are excluded
- npm integrity hashes (`sha512-...`) are not redacted
- JWT header segments are preserved
- Package version references pass through

### Deterministic Placeholders

All masked values are replaced with stable placeholders: `[REDACTED_1]`, `[REDACTED_2]`, etc. The same secret always maps to the same placeholder within a session, ensuring consistency.

### Streaming Scrubber

The `StreamScrubber` class handles real-time token-by-token scrubbing during LLM output streaming. It buffers partial tokens to prevent secrets from being split across chunks.

---

## 5. Path Policy Engine

### Hardcoded Bans

The following paths are always blocked, regardless of profile or policy:

| Path | Reason |
|---|---|
| `~/.ssh/` | SSH private keys |
| `/etc/` | System configuration |
| `/boot/` | Boot loader |
| `/dev/` | Device files |
| `/` (root) | Prevents root-level operations |

### `.getitignore`

Works like `.gitignore` — place it in your project root or any parent directory:

```gitignore
# Block private keys
*.pem
*.key

# Block environment files
.env*

# Block secrets directory
/secrets/*
```

**Resolution order:**
1. Patterns are collected hierarchically from `$PWD` up to the filesystem root
2. Each directory's `.getitignore` is merged into the pattern set
3. Global patterns from `~/.config/getit/policy.json` are added
4. Hardcoded bans are applied last (cannot be overridden)

### Absolute Path Enforcement

All file operations resolve paths to their absolute, real form before any policy check:
- `~` is expanded to the home directory
- Symlinks are resolved to their targets
- Relative paths are resolved against the current working directory
- `..` traversals are normalized

This prevents bypass attempts using symlinks or relative paths.

### Workspace Boundary

When a workspace manifest is active, the policy engine injects an additional rule that blocks writes outside the workspace root — unless the target is an explicitly allowlisted global path (e.g., `~/.config/`, `~/.bashrc`).

---

## 6. Input Sanitization

The input sanitizer scans bash commands for dangerous patterns before they reach the MITL gate:

| Pattern | Detection | Risk |
|---|---|---|
| `&&`, `\|\|`, `;` | Shell cascades | Hidden secondary commands |
| `>`, `>>` | Output redirects | Overwriting sensitive files |
| `<` | Input redirects | Reading sensitive files |
| `$(...)`, `` ` `` | Subshell expansion | Hidden command execution |
| `\|` to dangerous commands | Piped exfiltration | Data exfiltration |

Detected patterns generate warnings that are displayed prominently on the MITL approval card. The command is **not blocked** — the user sees the warnings and makes an informed decision.

---

## 7. Environment Isolation

### Child Process Environment

Before spawning any child process, `getSafeEnv()` creates a clean environment:

```typescript
const safeEnv = { ...process.env };
delete safeEnv.OPENROUTER_API_KEY;
delete safeEnv.OPENAI_API_KEY;
delete safeEnv.ANTHROPIC_API_KEY;
delete safeEnv.GITHUB_TOKEN;
delete safeEnv.GETIT_API_KEY;
// ... all known sensitive keys
```

This prevents credential exfiltration via `env`, `printenv`, or malicious scripts that read environment variables.

### Structured Communication Only

The LLM communicates exclusively through typed JSON tool schemas:
- `execute_bash` receives a single `command` string
- `manage_file` receives structured parameters

Raw, unparsed shell string execution is architecturally impossible. The command is always passed to `spawn('/bin/bash', ['-c', command])` after full policy and sanitization checks.

---

## 8. Fail-Closed Execution

Every safety mechanism defaults to denial:

| Scenario | Behavior |
|---|---|
| Command exits with non-zero code | Agent loop halts immediately; no automatic retry |
| Path validation fails | Operation is blocked before reaching MITL gate |
| Tool arguments cannot be parsed | Turn halts with error message |
| API key is missing | Carrier initialization fails; no requests sent |
| 10+ tool calls in one turn | Runaway guard halts the loop |
| Child process is actively streaming | MITL prompts are suppressed (returns denial) |

### Non-Zero Exit Code Handling

When a command fails:
1. The agent loop halts immediately
2. The deterministic healer scans `stderr` for known failure patterns
3. If a match is found, a fix command is proposed through the MITL gate
4. **The healer never auto-executes** — the user must approve
5. If no match is found, control returns to the user

---

## 9. Workspace Security

### Shadow Tracking Repository

The shadow tracking repo at `~/.local/state/getit/tracking/` stores only scrubbed file content:

- Files pass through `scrubContentGeneric()` before staging
- High-entropy strings and known secrets are replaced with placeholders
- The live operational files remain untouched
- `getit inspect` lets you verify what's tracked before any commit

### Rollback Safety

The rollback system includes multiple safety checks:
- Commit hashes are validated (7-40 hex characters)
- Target paths are checked against the workspace boundary
- Each file restoration goes through the MITL gate
- Atomic writes prevent partial-restore corruption

### Export Security

`getit export` produces scrubbed copies of all tracked files. The export directory contains zero raw secrets by design.

---

## 10. Security Profiles

| Profile | Description |
|---|---|
| `strict` | Maximum protection. Blocks all default system targets, hidden configs, and all `.getitignore` patterns. Recommended for production environments. |
| `normal` | Balanced protection. Enforces base policy and hardcoded bans. Allows local credential updates with MITL confirmation. Default profile. |
| `override` | Minimal protection. Only enforces an explicit user-specified allowlist. Use with caution. |

Select a profile at startup:
```bash
getit --profile strict
```

Or switch within the REPL:
```bash
/profile strict
```

---

## 11. Reporting Vulnerabilities

If you discover a security vulnerability in `getit`, please report it responsibly:

📬 **redstarapps@proton.me**

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact assessment
- Suggested fix (if any)

We will respond within 48 hours and work with you to address the issue before any public disclosure.

---

*This document reflects the security model of getit v1.5.0.*
