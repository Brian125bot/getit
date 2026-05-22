# getit ❯ Stateful, Man-in-the-Loop Terminal Workspace Agent

`getit` is a lightweight, Man-in-the-Loop (MITL), terminal-native workspace assistant designed to run statefully inside Unix-like terminals across Linux and macOS. It translates natural language intents into atomic system manipulations: discovering, downloading, installing, and updating software, as well as surgically editing system configuration files. Debian/Crostini remains a first-class tested environment.

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

* **Policy-Gated Paths**: Any tool interaction targeted at catastrophic system paths, default protected areas, global policy rules, or local `.getitignore` patterns fails immediately with a safety exception. Reads and writes are both blocked.
* **Secrets Containment**: Before running any child process or sending tool history back to the model, the active environment and logs are scrubbed of sensitive secrets. Repeated secrets are mapped consistently as `[REDACTED_N]`.
* **Input Sanitization**: Detects dangerous shell cascades (`&&`, `||`, `;`), subshells (`$()`, backticks), and output redirects (`>`, `>>`), issuing visual safety warnings to the user before prompt approval.
* **Fail-Closed Guarantee**: If a command exits with a non-zero status code, the program instantly halts the multi-turn loop, blocking automatic AI recovery attempts until you manually authorize a next step.
* **Ledger-Backed Undo**: File mutations are snapshotted under the XDG state directory before writes. `getit undo` restores the latest transaction batch and warns when a batch also included non-restorable commands.

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
- Binary check status (`curl`, `tar`, `unzip`, and the detected package manager).
- Package manager mapping for Debian/Ubuntu (`apt-get`), macOS (`brew`), Fedora/RHEL (`dnf`), and Arch (`pacman`).
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

### Phase 2: Async, Policy, Undo, and Dry-Run
- Bash execution uses asynchronous `spawn` streaming with stdout/stderr truncation before model-history insertion.
- `.getitignore` and `$XDG_CONFIG_HOME/getit/policy.json` provide project and global path policy.
- `--dry-run` captures native model tool calls into a roadmap. Approving the roadmap batch-authorizes the listed mutations.
- `getit undo` restores the latest file transaction batch from the native JSON ledger and snapshot store.

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
5. Configure your LLM carrier (interactive wizard recommended):
   ```bash
   getit --setup
   ```
   Or set keys manually in `.env` / `.getitrc` / `~/.getitrc`:
   ```text
   GETIT_CARRIER=openrouter
   GETIT_API_KEY=your-api-key
   GETIT_MODEL=nvidia/nemotron-3-super-120b-a12b:free
   ```

### Supported LLM carriers

| Carrier ID | Provider | Key env vars (first match wins) |
|------------|----------|----------------------------------|
| `openrouter` | OpenRouter | `OPENROUTER_API_KEY`, `GETIT_API_KEY` |
| `openai` | OpenAI | `OPENAI_API_KEY`, `GETIT_API_KEY` |
| `anthropic` | Anthropic | `ANTHROPIC_API_KEY`, `GETIT_API_KEY` |
| `google` | Google Gemini | `GOOGLE_API_KEY`, `GEMINI_API_KEY` |
| `groq` | Groq | `GROQ_API_KEY`, `GETIT_API_KEY` |
| `deepseek` | DeepSeek | `DEEPSEEK_API_KEY`, `GETIT_API_KEY` |
| `together` | Together AI | `TOGETHER_API_KEY`, `GETIT_API_KEY` |
| `mistral` | Mistral | `MISTRAL_API_KEY`, `GETIT_API_KEY` |
| `azure` | Azure OpenAI | `AZURE_OPENAI_API_KEY`, `GETIT_API_KEY` |
| `ollama` | Ollama (local) | No key required |
| `custom` | Any OpenAI-compatible URL | `GETIT_API_KEY` (optional) |

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

Phase 2 command additions:
```bash
getit --dry-run "install ripgrep and update my shell path"
getit --profile strict
getit undo
```

Carrier & model commands:
```bash
getit --setup                    # Interactive wizard (all carriers)
getit config                     # Show active carrier, model, timeout
getit doctor                     # Health check: API ping, git, gh
getit models                     # List models for active carrier
getit --model gpt-4o             # Override model for one session
```

Inside the REPL: `/carrier groq`, `/models`, `/model <id>`, `/config`, `/setup`.

Phase 3 workspace commands:
```bash
getit manifest init              # Initialize workspace manifest + profile dirs
getit status                     # Offline drift report
getit status --remote            # Drift + GitHub sync status (via gh)
getit inspect .env               # View scrubbed tracking mirror
getit export [output-dir]        # Bulk export scrubbed tracked files
getit resolve                    # Interactively resolve drift (with AI advisory)
getit history                    # Shadow Git commit history
getit rollback <hash> [file]     # Roll back live files to a shadow commit
```

Inside the REPL, carrier commands (`/carrier`, `/models`, `/model`, `/config`, `/setup`), workspace commands (`/status`, `/resolve`, `/sync`, `/export`, `/history`, `/rollback`), and safety commands (`/undo`, `/dry-run`, `/policy`) are handled locally rather than being sent to the model.

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

`getit` features a comprehensive test suite (112 tests) executed using Node's native test runner:

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

### 4. Phase 2 & Phase 3 Suites (`tests/phase2-*.test.ts`, `tests/phase3-*.test.ts`)
- Async execution, policy engine, scrubbing, dry-run, platform matrix.
- Workspace manifest, drift, healer, remote sync, export, profiles, history/rollback.

### 5. Multi-Carrier Suite (`tests/carriers-*.test.ts`)
- Carrier registry presets, auth modes, transport headers, config loader per provider.
