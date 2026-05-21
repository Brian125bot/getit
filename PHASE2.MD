# Phase 2 Engineering Plan & Source of Truth: `getit` Workspace Agent

This document serves as the absolute specification, execution blueprint, and source of truth for an agentic coding agent to implement the **Phase 2 Upgrades** for the `getit` Workspace Agent.

---

## 1. System Context & Architectural Alignment

Phase 1 established `getit` as a lightweight, single-turn, terminal-native assistant tailored for isolated environments like ChromeOS Linux (Crostini Debian).

Phase 2 transitions the platform into a highly performant, enterprise-safe ecosystem designed for cross-platform compliance and asynchronous processing. The architectural relationship between Phase 1 constraints and Phase 2 requirements is structured as follows:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Phase 1 Tool Interceptor                        │
│             - child_process.execSync (Blocks Event Loop)               │
│             - Hardcoded Path Blacklists (~/.ssh, /etc)                 │
└───────────────────────────────────┬────────────────────────────────────┘
                                    ▼  [Refactored into]
┌────────────────────────────────────────────────────────────────────────┐
│                        Phase 2 Execution Kernel                        │
│                                                                        │
│  ┌────────────────────────┐ ┌────────────────────────┐ ┌────────────┐  │
│  │ Asynchronous Process   │ │ Plan-Ahead & Dry-Run   │ │ Git-Backed │  │
│  │ Kernel (Output Stream) │ │ Compiler (Multi-Step)  │ │ Rollback   │  │
│  └───────────┬────────────┘ └────────────────────────┘ └────────────┘  │
│              ▼                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Advanced Scrubber Pipeline                                       │  │
│  │ - Policy-Driven Engine (.getitignore / RBAC Rules)               │  │
│  │ - Entropy-Based Token Masking (Secret and Patch Verification)     │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘

```

---

## 2. Core Modules & Phase 2 Technical Specifications

### Module A: Asynchronous Process Kernel & Stream Pipeline

#### 1. Context & Rationale

Phase 1 utilizes synchronous execution (`child_process.execSync`), which blocks the Node.js event loop. This freezes the user interface during long compilation procedures, software updates, or remote downloads, failing to provide interactive user signals like active progress bars or incremental build metrics. Phase 2 replaces this with a fully asynchronous stream management processor.

#### 2. Detailed Implementation Requirements

* **Asynchronous Spawn Engine:** Refactor execution blocks from `execSync` to native `child_process.spawn`. Set the default shell configuration explicitly to `/bin/bash` or user-defined dynamic target context while guaranteeing stream boundaries.
* **Real-time Terminal Streaming:** Wire standard child process channels (`stdout`, `stderr`) directly back to the active CLI display. The UI layer must emit output text as it arrives from the process buffer.
* **Token-Aware Context Buffer:** Intercept the arriving character buffers. While streaming directly to the display, redirect the stream concurrently into an in-memory sliding token tracker.
* **Log Truncator Strategy:** If the aggregated process payload exceeds `2,000 tokens` (roughly 150 lines of logs), apply a truncating filter. The context structure returned to the language model must only present the initial 20 lines, a explicit structural deletion message (`[... Dynamic Truncation: X lines of log data removed to maintain context context ...]`), and the final 50 lines of execution logs or standard error lines.
* **Graceful Lifecycle Handlers:** Explicitly bind interrupt events (`SIGINT`, `SIGTERM`) within the parent node architecture down to the underlying child spawn group using standard process control masks.

#### 3. Strict Verification & Acceptance Criteria

* **ASYNCH_001:** Executing a lengthy continuous process (e.g., `sleep 5 && echo "Done"`) must emit text dynamically to the screen prior to execution completion without locking the input REPL.
* **ASYNCH_002:** Standard error responses must be explicitly captured and forwarded to the truncation engine without interrupting state processing loops.
* **ASYNCH_003:** Providing an installation command that targets more than 10,000 lines of console data must preserve system stability and submit less than `2,500 tokens` back to the OpenRouter orchestration history.

---

### Module B: Git-Backed Rollback & Backup Engine

#### 1. Context & Rationale

Modifying configuration targets and system files using LLM-generated patch models is inherently risky. Even verified diff algorithms can generate erroneous outputs or break operational systems due to unhandled configuration states. Phase 2 enforces absolute non-destructive target updates through automated git tracking and local shadow storage.

#### 2. Detailed Implementation Requirements

* **Shadow Repository Generation:** Upon initialization within a target system area or project space, verify the existence of a local tracking space located at `~/.local/state/getit/backup/`. If missing, generate the directory structure dynamically.
* **Target Snapshots:** Before any tool writes, edits, or deletes a file configuration via file management actions, parse the file path. Copy the asset into the shadow directory layout using an absolute path mapping scheme.
* **State Compression History:** Package historical system changes as atomic records. Every action must commit the targeted files into a localized shadow repository tracking historical delta footprints.
* **Explicit Rollback Action:** Expose a primary management target command: `getit undo`. When executed, read the latest shadow commit, extract the snapshot array, and write the verified original code parameters directly back to the original operational path location.

#### 3. Strict Verification & Acceptance Criteria

* **ROLL_001:** Modifying a verified document (e.g., `~/.bashrc`) must instantly create a corresponding duplicate inside the system backup shadow space prior to tool application.
* **ROLL_002:** Triggering the `getit undo` function must cleanly replace modified file records with the exact byte properties of the snapshot state, returning a success confirmation.
* **ROLL_003:** If a file write operations breaks midway, the underlying transaction layer must fail safe and return the initial tracking node state.

---

### Module C: Policy-Driven Protection Engine (.getitignore)

#### 1. Context & Rationale

Phase 1 relies entirely on a hardcoded collection of static tracking vectors (such as `~/.ssh/` or `/etc/`) to block file interactions. This approach is too rigid for production systems. Advanced developers need the ability to explicitly white-list administrative domains or black-list project-specific locations containing proprietary data or secure credentials.

#### 2. Detailed Implementation Requirements

* **Dynamic Ignore Configurations:** Establish a structural configuration layout file format named `.getitignore`. The lookup engine must parse patterns hierarchically from the active current working directory (`$PWD`), up through parental path chains, and finally resolve fallback parameters against global values located at `~/.config/getit/policy.json`.
* **Pattern Specification Matching:** Support standard glob parsing mechanics (e.g., `/secrets/*`, `.env*`, `/private_key`).
* **Role-Based Execution Profiles:** Construct three distinct authorization states within the engine runner profile:
* `Strict`: Blocks all default system targets, configuration areas, hidden configurations, and path references matching `.getitignore`.
* `Normal`: Enforces base configurations while allowing localized credential updates if explicitly confirmed via the manual validation terminal prompt.
* `Override`: Opens target modifications exclusively to user-specified white-listed file definitions.


* **Pre-Execution Pipeline Interception:** Every file creation, deletion, or patch transaction must validate absolute resolved targets against the policy map before displaying the selection card to the user.

#### 3. Strict Verification & Acceptance Criteria

* **POL_001:** Placing a target path rule matching `*.pem` inside a local `.getitignore` file must cause any model attempt to read or modify a `.pem` file to fail immediately with a policy violation warning.
* **POL_002:** Global rules located in `~/.config/getit/policy.json` must be respected regardless of the current working directory.
* **POL_003:** Attempting to traverse directory boundaries using symlinks targeted at protected directories must be detected and blocked.

---

### Module D: High-Entropy Secrets Scanning & Dynamic Masking

#### 1. Context & Rationale

Simple key-word matching checks (such as finding `SECRET` or `PASSWORD` strings) fail to stop token leakage. Private authorization payloads, raw private certificates, and high-entropy API tokens are frequently embedded directly within setup files or installation logs without explicitly descriptive variable names.

#### 2. Detailed Implementation Requirements

* **Shannon Entropy Verification Algorithms:** Implement a localized data scanning function that evaluates string payloads using standard Shannon Entropy metrics:

$$\text{Entropy} = -\sum (p_i \log_2 p_i)$$


* **High-Entropy Trigger Thresholds:** Any contiguous string cluster containing no white-space that exhibits an entropy rating higher than `4.5` (typical for hex strings) or `5.1` (typical for base64 targets) must be flagged for closer inspection.
* **Ecosystem Regex Definitions:** Layer standard credential scanning expressions to catch common cloud keys, OpenRouter markers, GitHub authorization strings, and explicit base platform targets.
* **Automated Data Masking Filters:** Before writing data to the console loop, exporting debugging snapshots, or sending tool execution history back to OpenRouter providers, replace flagged high-entropy strings with a secure placeholder: `[SECURE_MASKED_CREDENTIAL_VALUE]`.

#### 3. Strict Verification & Acceptance Criteria

* **SEC_001:** Passing an un-labeled high-entropy string (e.g., `amdf83jd92830fjsn3810fjsm39102jf`) inside an installation output log must trigger masking before the data leaves the engine boundaries.
* **SEC_002:** Legitimate programmatic inputs (such as standard source files or common configuration formatting) must not trigger false positives.
* **SEC_003:** Masked token references must remain consistently trackable across the conversation loop state to prevent structural context loss.

---

### Module E: Cross-Platform Environment Mapping Matrix

#### 1. Context & Rationale

Phase 1 targets Crostini Debian distributions by hardcoding `apt-get` checks and assuming localized standard environments. This approach breaks when developers deploy the assistant on alternative Unix platforms like macOS or enterprise Linux variants, resulting in hallucinated installation commands.

#### 2. Detailed Implementation Requirements

* **Dynamic Distribution Fingerprinting:** Expand system discovery to inspect host data via native platforms (`os.platform()`, `os.release()`). Execute platform checks against `/etc/os-release` or standard Darwin shell interfaces (`sw_vers`).
* **Unified Package Management Adapter Framework:** Abstract execution actions into structural driver interfaces:
* Debian/Ubuntu: Bind commands to `apt-get` / `dpkg`.
* macOS: Bind commands to Homebrew (`brew`).
* Fedora/RHEL: Bind commands to `dnf`.
* Arch Linux: Bind commands to `pacman`.


* **Dynamic Binary Validation Strategy:** Dynamically check for missing utility requirements (`curl`, `tar`, `unzip`) using platform-appropriate validation queries (e.g., `which`, `whereis`, `command -v`).
* **System Prompt Injection Architecture:** Format the discovered environment attributes into a clean, injection-ready prompt schema:

```json
{
  "system_environment": {
    "target_platform": "darwin",
    "distribution_release": "macOS 14.4",
    "primary_package_manager": "brew",
    "user_binary_path": "/opt/homebrew/bin",
    "verified_binaries": ["curl", "tar", "unzip"]
  }
}

```

#### 3. Strict Verification & Acceptance Criteria

* **PLAT_001:** Executing the engine on a macOS system must set the primary package manager parameter to `brew` and identify the corresponding homebrew bin path.
* **PLAT_002:** If a system package manager encounters a lock condition or error, the exception must be propagated to the loop controller.
* **PLAT_003:** The LLM context instruction array must strictly mandate that all emitted package commands use the discovered package manager.

---

### Module F: Multi-Step "Plan-Ahead" Compiler (Dry-Run Mode)

#### 1. Context & Rationale

Stepping through interactive prompts one terminal task at a time is inefficient for large configuration setups. Users need to review the agent's full plan up front, allowing them to inspect the entire sequence of changes before executing any destructive operations.

#### 2. Detailed Implementation Requirements

* **Compilation Flag Interface:** Expose an absolute initialization option flag: `getit --dry-run`.
* **Multi-Step Strategy Request:** Instruct the orchestration model to return a structured sequence array detailing *every* execution command, directory alteration, and file adjustment required to fulfill the user's request.
* **Consolidated Manifest Generation:** Parse the sequence array into an evaluation document schema (`manifest.json`) and a readable Markdown execution summary.
* **Structured Dependency Assessment:** Review the planned action list to identify potential execution bottlenecks, such as attempting to use an application before its corresponding installation command has run.
* **User Confirmation Interface:** Render the completed action sequence on screen. Prompt the user for validation: `Proceed with executing all actions? [y/N]`. If approved, pass the instructions sequentially to the execution engine.

#### 3. Strict Verification & Acceptance Criteria

* **PLAN_001:** Passing the `--dry-run` flag must prevent any direct command executions or file writes from occurring before final user validation.
* **PLAN_002:** The system must generate a readable markdown roadmap summarizing all planned tasks.
* **PLAN_003:** If a user rejects the compiled execution roadmap, the program must exit cleanly without changing any system configurations.

---

## 3. Implementation Blueprint & Phase 2 Milestone Roadmap

To ensure development remains structured and maintainable, the coding agent must execute upgrades across four sequential development tracks:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Phase 2 Implementation Timeline                                        │
├────────────────────────────────────────────────────────────────────────┤
│ Track 1: Asynchronous Execution Core & Streaming Interfaces            │
│          [Delivers: Asynchronous Spawn Kernel, Token Log Filters]       │
├────────────────────────────────────────────────────────────────────────┤
│ Track 2: Advanced Policy Validation & Shadow Git Backups               │
│          [Delivers: .getitignore Engine, Dynamic File Backups]          │
├────────────────────────────────────────────────────────────────────────┤
│ Track 3: Cross-Platform Adapter Array & Entropy Scrubber Matrix        │
│          [Delivers: Multi-Distro Handlers, Shannon Masking Engine]      │
├────────────────────────────────────────────────────────────────────────┤
│ Track 4: Plan-Ahead Engine & Consolidated Pipeline Validation          │
│          [Delivers: Manifest Compiler, End-to-End Test Matrix]          │
└────────────────────────────────────────────────────────────────────────┘

```

---

## 4. Prompt Instructions for the Agentic Coding Agent

When acting as the agentic coding agent responsible for writing this system, adhere to these explicit instructions:

### System Generation Operational Rules

1. **Zero Production Dependencies Protection:** Maintain the project's strict architectural constraint: **zero runtime production dependencies**. All features—including glob pattern matchers, Shannon entropy scoring, and log truncators—must be written using native Node.js core modules and vanilla TypeScript.
2. **Fail-Closed Execution Design:** Wrap all child process interactions in strict try-catch blocks. If an execution step fails or returns a non-zero exit code, immediately stop the loop execution, save the error state, and return control back to the user.
3. **Defensive Path Validation:** Ensure all file access routines run absolute path checks (`path.resolve`) against the dynamic policy configuration engine before triggering any read, write, or diff actions.

### Code Writing Strategy Reference

Use this structural implementation pattern for writing the core asynchronous process streaming interface:

```typescript
import { spawn } from 'child_process';
import { Transform } from 'stream';

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function executeCommandAsync(
  command: string, 
  args: string[], 
  options: { env: Record<string, string>; cwd: string }
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    // Implement standard cross-platform terminal execution rules
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: '/bin/bash'
    });

    let stdoutAccumulator = '';
    let stderrAccumulator = '';

    child.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdoutAccumulator += chunk;
      // Direct stream link to screen to provide active user feedback
      process.stdout.write(chunk);
    });

    child.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderrAccumulator += chunk;
      process.stderr.write(chunk);
    });

    child.on('close', (code) => {
      resolve({
        exitCode: code ?? -1,
        stdout: stdoutAccumulator,
        stderr: stderrAccumulator
      });
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

```

---

## 5. Comprehensive Acceptance Test Specification Matrix

The test framework must validate these implementation patterns using Node's native test runner.

### Asynchronous Streaming Tests (`tests/phase2-async.test.ts`)

* **Test Case 1:** Verify that `stdout` payloads emit streaming data events to terminal monitors prior to child process resolution.
* **Test Case 2:** Assert that the log truncator trims log arrays exceeding `2,000 tokens`, maintaining context integrity while preserving the first 20 and last 50 execution output lines.

### Shadow Directory Backup Tests (`tests/phase2-backup.test.ts`)

* **Test Case 1:** Modifying an existing system asset file must automatically duplicate its contents inside `~/.local/state/getit/backup/`.
* **Test Case 2:** Invoking the `getit undo` action must completely restore mutated files to their original byte configurations.

### Access Control Policy Tests (`tests/phase2-policy.test.ts`)

* **Test Case 1:** Assert that file patch paths containing terms explicitly blocked by an active `.getitignore` schema reject execution gracefully before displaying the confirmation card.
* **Test Case 2:** Verify that directory parsing resolves correctly when encountering nested `.getitignore` configurations across different path layers.

### Security and Entropy Scrubbing Tests (`tests/phase2-scrub.test.ts`)

* **Test Case 1:** High-entropy configuration strings (e.g., standard base64 blocks or private key values) must be masked with `[SECURE_MASKED_CREDENTIAL_VALUE]` before being passed to external API connections.
* **Test Case 2:** Standard alphanumeric programmatic configurations must pass through the validation engine without triggering false-positive alerts.

### Cross-Platform Matrix Validation Tests (`tests/phase2-platform.test.ts`)

* **Test Case 1:** Mocking a Darwin (macOS) kernel platform configuration must update the system discovery system prompt to explicitly require the use of the `brew` package manager.
* **Test Case 2:** Mocking an Enterprise RedHat environment configuration must update discovery system context prompts to utilize `dnf` installation frameworks.

### Plan-Ahead Dry-Run Compiler Tests (`tests/phase2-plan.test.ts`)

* **Test Case 1:** Initializing commands via the `--dry-run` flag must generate a complete, multi-step action plan manifest without applying any changes to the system.
* **Test Case 2:** Declining the generated execution manifest must clear out ephemeral state tracking parameters and exit cleanly.
