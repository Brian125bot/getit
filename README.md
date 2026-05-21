# getit ❯ Stateful, Man-in-the-Loop Terminal Workspace Agent

`getit` is a lightweight, Man-in-the-Loop (MITL), terminal-native workspace assistant designed to run statefully inside a ChromeOS Linux container (Crostini Debian). It translates natural language intents into atomic system manipulations: discovering, downloading, installing, and updating software, as well as surgically editing system configuration files.

Built completely from scratch in TypeScript (Node.js) with **zero production dependencies**, `getit` serves as a deterministic, secure supervisor over your terminal shell.

---

## 1. Core Philosophy & Design

Unlike fragile agent loops that spawn unstructured subshells or suffer from async context loss, `getit` implements:
1. **Isolated Execution Harness**: Full control over shell execution blocks, avoiding cascading AI failures.
2. **Deterministic State Management**: Active directories and paths are kept statefully inside the TypeScript runner. All file operations enforce absolute path resolution.
3. **Strict Parameter Typing**: Communication with OpenRouter LLMs occurs exclusively through structured JSON schemas. Raw string execution is prevented.

---

## 2. Multi-Tiered Security Sandboxing

To shield your host machine from untrusted web payloads (such as malicious repositories or modified install instructions), the runtime implements three absolute security barriers:

```
┌────────────────────────────────────────────────────────┐
│               OpenRouter API Output (LLM)              │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│               TypeScript Tool Interceptor              │
│  - Blocks Banned Paths (~/.ssh, /etc)                  │
│  - Sanitizes Inputs & Disallows Shell Cascades         │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│               Environment Scrubber (Env)               │
│  - Strips API Keys (OPENROUTER_API_KEY)                │
│  - Drops Sensitive System Secrets                      │
└───────────────────────────┬────────────────────────────┘
                            ▼
┌────────────────────────────────────────────────────────┐
│             Man-in-the-Loop Approval [Y/n/e]           │
└────────────────────────────────────────────────────────┘
```

* **Banned Path Vectors**: Any tool interaction targeted at `~/.ssh/`, `/etc/`, `/boot/`, `/dev/`, `/proc/`, `/sys/`, `/root/`, or the root `/` will fail immediately with a safety exception.
* **Secrets Containment**: Before running any child process, the active environment is scrubbed of sensitive secrets (including `OPENROUTER_API_KEY`, `GITHUB_TOKEN`, and any key matching the pattern `SECRET`, `PASSWORD`, or `TOKEN`).
* **Input Sanitization**: Detects dangerous shell cascades (`&&`, `||`, `;`), subshells (`$()`, backticks), and output redirects (`>`, `>>`), issuing visual safety warnings to the user before prompt approval.
* **Fail-Closed Guarantee**: If a command exits with a non-zero status code, the program instantly halts the multi-turn loop, blocking automatic AI recovery attempts until you manually authorize a next step.

---

## 3. Four-Stage Feature Set

### Stage 1: MITL Interceptor Gate
Every tool execution blocks until you authorize it. The interceptor clears a terminal line and displays a bordered card showing:
1. **Tool Context** (`BASH`, `FILE CREATE`, or `FILE PATCH`)
2. **Payload/Text** proposed by the model
3. **Safety Warnings** if cascades or redirects are detected

Prompts with exactly `[Y/n/e]`:
- `y` or Enter: Execute the command in a safe environment.
- `n`: Deny execution, passing `Execution denied by user.` back to history.
- `e`: Interactively edit the payload/command string before running.

### Stage 2: Ambient Environment Discovery
Runs once synchronously upon agent startup:
- CPU Architecture mapping (`x64` to `x86_64`, `arm64` to `arm64/aarch64`).
- Binary check status (`curl`, `tar`, `unzip`, `apt-get`).
- `$PATH` verification to see if the user local binaries path `~/.local/bin` is active.
- Appends this environment context dynamically to the base OpenRouter system prompt.

### Stage 3: Persistent REPL Shell
Maintains an interactive, multi-turn REPL loop that holds conversation history statefully.
- Emits a custom terminal prompt `getit-agent ❯ `.
- Intercepts `Ctrl+C` (SIGINT) and EOF cleanly to close readline streams and flush stdout.

### Stage 4: Unified ANSI Diff Patching
Enforces non-destructive configuration file patching:
- Generates line-by-line unified diffs using a custom Longest Common Subsequence (LCS) algorithm.
- Renders colored diff cards in the terminal above the MITL card:
  - Deletions in **Red** ANSI formatting (`\x1b[31m- `).
  - Additions in **Green** ANSI formatting (`\x1b[32m+ `).

---

## 4. Installation & Setup

### Prerequisites
- Node.js >= v20.0.0
- npm >= v10.0.0

### Steps
1. Clone the repository and navigate to the directory:
   ```bash
   cd projects/installer2
   ```
2. Install dev dependencies (zero production dependencies!):
   ```bash
   npm install
   ```
3. Build the TypeScript files:
   ```bash
   npm run build
   ```
4. Register the `getit` CLI command. You can do this in two ways:
   - **Option A: User-Space Symlink (Recommended & Pre-configured)**
     Creates a direct link in your pre-discovered user binary folder:
     ```bash
     mkdir -p ~/.local/bin
     ln -sf $(pwd)/dist/index.js ~/.local/bin/getit
     chmod +x ~/.local/bin/getit
     ```
   - **Option B: Npm Global Linking**
     ```bash
     npm link
     ```
5. Set your `OPENROUTER_API_KEY` using either environment variables or a local configuration file:
   - **Option A: Environment Variable**
     ```bash
     export OPENROUTER_API_KEY="your-openrouter-key"
     ```
   - **Option B: Local Config File**
     Create a `.env` or `.getitrc` file in the root of the project:
     ```text
     OPENROUTER_API_KEY=your-openrouter-key
     ```

---

## 5. Usage

To start the stateful agent REPL shell from **any directory** in your terminal, simply run:
```bash
getit
```

Alternatively, you can run in development/compilation mode inside the project directory:
```bash
npm run dev
```

Once loaded, you will see a system dashboard and a custom prompt:
```text
┌────────────────────────────────────────────────────────┐
│ GETIT WORKSPACE AGENT v1.0.0                           │
├────────────────────────────────────────────────────────┤
│ Architecture:  x86_64                                  │
│ Platform:      Linux                                   │
│ Dependencies:  curl:✓ tar:✓ unzip:✓ apt-get:✓          │
│ ~/.local/bin:  Registered ✓                            │
└────────────────────────────────────────────────────────┘
Type exit or press Ctrl+C to terminate the session.

getit-agent ❯ Install ripgrep and update my local shell path
```

---

## 6. Test Suite

`getit` features a professional and comprehensive double-suite test architecture (36 tests in total) executed using Node's native test runner:

```bash
npm test
```

### 1. Functionality Test Suite (`tests/functionality.test.ts`)
- Verifies architecture mapping and dependency detection.
- Tests dynamic env-file parsing and secrets fallback loader.
- Tests LCS unified diff coloring.
- Validates stateful working directories, absolute paths, and tilde expansions.
- Asserts file reading and metadata metrics.

### 2. Safety and Security Test Suite (`tests/safety.test.ts`)
- Asserts path-traversal blocking (`../../etc/shadow`), banned system paths, and target `/` protection.
- Validates sensitive env scrubber patterns (matching tokens, secrets, passwords).
- Checks input sanitization logic (banning cascades, redirects, subshells, backticks).

### 3. Stage-by-Stage Verification Tests (`tests/stage*.test.ts`)
- Validates manual rejection and MITL halting.
- Asserts environment variables and architectural injection in prompt context.
- Tests REPL session persistence and turn loop control.
- Tests colored patch diffs.
