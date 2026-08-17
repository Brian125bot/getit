# User Guide — getit v2.0

> Complete guide to CLI subcommands, interactive REPL slash commands, task recipes, encrypted vault, watch mode, and sync in getit v2.0.

---

## Table of Contents

- [Getting Started](#getting-started)
- [CLI Subcommands](#cli-subcommands)
- [Interactive REPL Slash Commands](#interactive-repl-slash-commands)
- [Task Recipes](#task-recipes)
- [Plugin System](#plugin-system)
- [File Watcher Mode](#file-watcher-mode)
- [Encrypted Vault](#encrypted-vault)
- [Multi-Machine Sync](#multi-machine-sync)
- [Policy Guardrails](#policy-guardrails)

---

## Getting Started

Build getit and launch the interactive shell:

```bash
npm run build
node dist/src/index.js
```

Or execute commands directly from your terminal:

```bash
node dist/src/index.js "Install ripgrep and check version"
```

---

## CLI Subcommands

| Subcommand | Description | Example |
|------------|-------------|---------|
| `run <prompt>` | Run prompt in one-shot mode | `getit run "Build project"` |
| `config` | View runtime configuration | `getit config` |
| `doctor` | Run system connectivity check | `getit doctor` |
| `models` | List models for active carrier | `getit models` |
| `manifest init` | Track current directory as workspace | `getit manifest init` |
| `status` | View configuration drift status | `getit status` |
| `inspect <file>` | Inspect scrubbed tracking mirror | `getit inspect .env` |
| `stage` / `resolve` | Interactively resolve workspace drift | `getit resolve` |
| `export [dir]` | Export scrubbed copy of tracked files | `getit export ./out` |
| `history` / `log` | View tracking commit log | `getit log` |
| `rollback <hash>` | Roll back workspace state to commit | `getit rollback 8a3f2b1` |
| `undo` | Restore latest transaction | `getit undo` |
| `watch` | Run file watcher daemon | `getit watch` |
| `plugins [reload]` | List or reload plugins | `getit plugins reload` |
| `sync` | List sync profiles | `getit sync` |
| `recipe run <name>` | Execute saved task recipe | `getit recipe run deploy` |

---

## Interactive REPL Slash Commands

Inside the REPL (`node dist/src/index.js`), use the following commands:

- `/help` — Display command help menu
- `/carrier [id]` — Display active carrier or switch (e.g. `/carrier groq`)
- `/model [name]` — Display or override active LLM model
- `/dashboard` — Open multi-pane terminal dashboard
- `/watch [start|stop|status]` — Control file system watcher daemon
- `/recipe [list|run|record|save]` — Record, list, and run task recipes
- `/vault [status|init|unlock|lock|get|set|delete|list]` — Manage encrypted credential vault
- `/sync [status|push|pull]` — Sync runtime profiles across machines
- `/memory` — View session memory and project tech stack context
- `/plugins [reload|info <name>]` — Inspect or reload custom plugin tools

---

## Task Recipes

Record interactive steps and replay them later:

1. **Start Recording:**
   ```
   /recipe record setup-env
   ```
2. **Perform Actions:** Execute shell commands or file changes through normal prompt turns.
3. **Save Recipe:**
   ```
   /recipe save setup-env
   ```
4. **Replay Recipe:**
   ```bash
   node dist/src/index.js recipe run setup-env
   ```

Recipes are stored as YAML files in `.getit/recipes/` or `~/.config/getit/recipes/`.

---

## Plugin System

Create custom tools by placing `.ts` or `.js` files in `.getit/tools/` or `~/.config/getit/tools/`:

```javascript
export default {
  name: "check_disk_space",
  description: "Checks available disk space on host",
  risk: "read",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path to inspect" }
    }
  },
  execute: async (args) => {
    return { output: "Disk space normal" };
  }
};
```

---

## Encrypted Vault

Store API tokens and sensitive credentials using AES-256-GCM encryption:

```
/vault init
/vault set openrouter_key sk-or-v1-...
/vault get openrouter_key
/vault lock
```

Vault data is encrypted on disk at `~/.config/getit/vault.enc`.

---

## Multi-Machine Sync

Export and import runtime configurations across devices:

- **Push Profile:** `/sync push macbook-pro`
- **Pull Profile:** `/sync pull macbook-pro`
- **List Profiles:** `/sync status`

---

## Policy Guardrails

Define structural workspace rules in `.getit/policy.json`:

```json
{
  "enabled": true,
  "rules": [
    {
      "id": "no-secrets",
      "description": "Block hardcoded secrets",
      "severity": "block",
      "targetPaths": ["src/**/*"],
      "forbiddenPatterns": ["api_key\\s*=\\s*['\"][A-Za-z0-9]{20,}['\"]"]
    }
  ]
}
```

When violations are detected during file modifications, the MITL gate presents `[Y] Heal`, `[i] Ignore`, or `[a] Abort` options.
