# getit v2.1 — Natural Language Pipelines

## Complete Engineering Specification

**Status:** Source of Truth — Implementation Reference  
**Author:** Viktor AI (Product Engineering)  
**Base Version:** v2.0.0 (branch `v2.0`)  
**Target:** v2.1.0  
**Constraint:** Zero production dependencies. Node.js ≥ 20 native modules only.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Design Philosophy](#2-design-philosophy)
3. [Core Concepts](#3-core-concepts)
4. [Pipeline Syntax & Grammar](#4-pipeline-syntax--grammar)
5. [Pipeline Engine (`src/pipelines/`)](#5-pipeline-engine-srcpipelines)
6. [Stage Execution Model](#6-stage-execution-model)
7. [Inter-Stage Data Protocol](#7-inter-stage-data-protocol)
8. [MITL Integration](#8-mitl-integration)
9. [Branching, Conditionals & Control Flow](#9-branching-conditionals--control-flow)
10. [Error Handling & Recovery](#10-error-handling--recovery)
11. [Pipeline Memory & Persistence](#11-pipeline-memory--persistence)
12. [TUI Integration](#12-tui-integration)
13. [Plugin Interop](#13-plugin-interop)
14. [Recipe Interop](#14-recipe-interop)
15. [CLI Commands & REPL Surface](#15-cli-commands--repl-surface)
16. [Configuration (`.getitrc` & `.getit/pipelines/`)](#16-configuration-getitrc--getitpipelines)
17. [Security Model](#17-security-model)
18. [File Layout & Project Structure](#18-file-layout--project-structure)
19. [Type Definitions (`src/pipelines/types.ts`)](#19-type-definitions-srcpipelinestypests)
20. [Acceptance Test Matrix](#20-acceptance-test-matrix)
21. [Migration & Compatibility](#21-migration--compatibility)
22. [Implementation Roadmap](#22-implementation-roadmap)

---

## 1. Executive Summary

Natural Language Pipelines (NL Pipelines) are getit's answer to Unix pipes — but instead of chaining programs that transform byte streams, they chain **intents** that transform **semantic context**.

```
getit pipe "find all TODO comments in src/" \
         | "group by urgency and categorize" \
         | "create GitHub issues for critical ones" \
         | "post a summary to Slack"
```

Each stage is a full agent loop with MITL gating. The output of one stage becomes the input context for the next. Where Unix pipes are structural (bytes in → bytes out), NL pipes are *semantic* — the agent at each stage *understands* what it received and decides how to act on it.

### Why This Matters

| Limitation | Recipes (v2.0) | NL Pipelines (v2.1) |
|---|---|---|
| Adaptability | Static step sequences — same tools every run | Dynamic — stage 2's behavior depends on stage 1's output |
| Composability | Monolithic YAML files | Ad-hoc chaining on the command line |
| Reusability | Whole-recipe reuse only | Individual stages are reusable building blocks |
| Expressiveness | Imperative ("do X then Y") | Declarative ("transform X into Y then act on Y") |
| Discovery | Must pre-author recipes | Build pipelines interactively, promote to saved pipelines |

Recipes are *programs*. Pipelines are *shell one-liners*. Both are essential; they solve different problems at different levels of abstraction.

### Core Tenets Preserved

| Tenet | v2.0 | v2.1 Extension |
|---|---|---|
| Zero Dependencies | 0 production deps | Still 0. Pipeline engine uses only `node:*` built-ins. |
| Man-in-the-Loop | MITL gate on every mutation | Every stage passes through MITL. Stage-level and step-level gating. |
| Fail-Closed | Non-zero exit halts turn | Stage failure halts pipeline unless recovery strategy specified. |
| Deterministic State | Hashed JSON stores | Pipeline execution creates a deterministic manifest for replay/audit. |

---

## 2. Design Philosophy

### 2.1 The Semantic Pipe Operator

In Unix:
```bash
grep -r "TODO" src/ | sort | uniq -c | sort -rn
```

Each program receives raw text from stdin, transforms it, and emits raw text to stdout. The programs are *stupid* — `sort` doesn't know it's sorting TODO comments. The *user* holds the semantic understanding.

In getit:
```
getit pipe "find all TODO comments" | "group by urgency" | "create issues for criticals"
```

Each stage receives **structured semantic context** from the previous stage. The agent at each stage *understands* what it's working with. "group by urgency" doesn't need to know the format of the TODO list — it reads it, understands it, and restructures it intelligently.

This is the fundamental insight: **the LLM is the universal adapter between stages**. No format negotiation. No schema coupling. Each stage speaks natural language.

### 2.2 Principle of Least Commitment

A pipeline stage specifies *what* to accomplish, not *how*. The agent chooses tools, strategies, and output formats based on:
- The current stage's intent
- The incoming context from the previous stage
- The workspace state (files, project type, available tools)
- User preferences (from Module B memory)

This means the *same pipeline* adapts to different projects. "find all TODO comments" uses `grep` in a Node project, `rg` if ripgrep is installed, and AST parsing if a suitable plugin exists.

### 2.3 Bounded Autonomy

Each pipeline stage is a contained agent loop with:
- A hard iteration cap (configurable, default 10 tool calls per stage)
- A timeout (configurable, default 120s per stage)
- Full MITL gating on every mutation
- An explicit output capture mechanism

The pipeline cannot "run away" because each stage is independently bounded.

---

## 3. Core Concepts

### 3.1 Terminology

| Term | Definition |
|---|---|
| **Pipeline** | An ordered sequence of stages connected by the pipe operator. |
| **Stage** | A single natural language intent that receives context and produces output. |
| **Context** | The semantic data flowing between stages — structured text, JSON, file references, or any agent output. |
| **Tap** | A side-effect stage that observes context without modifying it (logging, notifications). |
| **Gate** | A stage that filters context — only passes data matching a condition. |
| **Fan-out** | A control flow operator that splits context into parallel sub-pipelines. |
| **Fan-in** | A control flow operator that merges results from parallel sub-pipelines. |
| **Checkpoint** | A named point in the pipeline where context is persisted to disk for resumption. |
| **Pipeline Manifest** | An immutable JSON record of a pipeline execution (inputs, outputs, timing, decisions). |

### 3.2 Data Flow Model

```
┌─────────────┐     context     ┌─────────────┐     context     ┌─────────────┐
│  Stage 1    │ ──────────────▶ │  Stage 2    │ ──────────────▶ │  Stage 3    │
│  "find..."  │                 │  "group..." │                 │  "create.." │
│             │                 │             │                 │             │
│  [Agent]    │                 │  [Agent]    │                 │  [Agent]    │
│  [MITL]     │                 │  [MITL]     │                 │  [MITL]     │
│  [Tools]    │                 │  [Tools]    │                 │  [Tools]    │
└─────────────┘                 └─────────────┘                 └─────────────┘
       │                               │                               │
       ▼                               ▼                               ▼
   Manifest                        Manifest                        Manifest
   Entry                           Entry                           Entry
```

Each stage:
1. Receives the previous stage's output as input context
2. Runs a full agent loop (LLM reasoning → tool calls → MITL approval → execution)
3. Produces structured output that becomes the next stage's input
4. Records its execution in the pipeline manifest

---

## 4. Pipeline Syntax & Grammar

### 4.1 CLI Syntax

```
getit pipe <intent-1> [| <intent-2> [| <intent-3> ...]] [options]
```

#### Inline Mode (ad-hoc)
```bash
# Simple linear pipeline
getit pipe "find all TODO comments in src/" | "group by urgency" | "create GitHub issues"

# With options
getit pipe "scan for security vulnerabilities" | "rank by severity" --timeout 300

# With variables
getit pipe "find files modified in the last {{days}} days" | "summarize changes" --var days=7

# With named stages for debugging
getit pipe find:"find all TODO comments" | group:"group by urgency" | act:"create issues"
```

#### File Mode (saved pipelines)
```bash
# Run a saved pipeline
getit pipe --file .getit/pipelines/todo-to-issues.yaml

# Run with variable overrides
getit pipe --file .getit/pipelines/deploy.yaml --var env=staging --var dry_run=true
```

### 4.2 Pipe Operator Variants

| Operator | Meaning | Example |
|---|---|---|
| `\|` | Standard pipe — pass full context | `"find TODOs" \| "group them"` |
| `\|>` | Tap — observe context, don't modify it | `"find TODOs" \|> "log count to analytics" \| "group them"` |
| `\|?` | Gate — only pass context if condition met | `"find TODOs" \|? "are there more than 10?" \| "create issues"` |
| `\|!` | Transform — reformat context before passing | `"find TODOs" \|! "extract only file paths" \| "lint those files"` |

### 4.3 Formal Grammar (EBNF)

```ebnf
pipeline      ::= stage (pipe_op stage)*
stage         ::= [stage_name ":"] intent [stage_opts]
stage_name    ::= IDENTIFIER
intent        ::= QUOTED_STRING
pipe_op       ::= "|" | "|>" | "|?" | "|!"
stage_opts    ::= ("--timeout" NUMBER | "--retries" NUMBER | "--model" STRING)*

QUOTED_STRING ::= '"' [^"]* '"' | "'" [^']* "'"
IDENTIFIER    ::= [a-z][a-z0-9_-]*
NUMBER        ::= [0-9]+
STRING        ::= [^\s]+
```

### 4.4 YAML Pipeline Format (Saved Pipelines)

```yaml
# .getit/pipelines/todo-to-issues.yaml

name: todo-to-issues
version: "1.0"
description: "Find TODOs, categorize by urgency, and create GitHub issues for critical ones."
author: "brian"

variables:
  source_dir:
    description: "Directory to scan for TODOs"
    default: "src/"
  severity_threshold:
    description: "Minimum severity to create issues for"
    default: "high"
    type: string
    enum: [low, medium, high, critical]

stages:
  - id: find
    intent: "Find all TODO, FIXME, HACK, and XXX comments in {{source_dir}} with file paths and line numbers"
    timeout: 60

  - id: categorize
    intent: "Categorize each item by urgency (critical/high/medium/low) based on the keyword, surrounding code context, and whether it's in a hot path"
    timeout: 90

  - id: filter
    intent: "Filter to only items with severity {{severity_threshold}} or above"
    type: gate

  - id: create-issues
    intent: "For each remaining item, create a GitHub issue with the file path, line number, surrounding code context, and suggested fix approach"
    timeout: 180
    mitl: per-item  # Ask approval for each issue individually

  - id: report
    intent: "Summarize what was found and what issues were created in a markdown table"
    type: tap  # Side effect — doesn't modify the pipeline context
```

### 4.5 Advanced YAML Features

#### Fan-Out / Fan-In (Parallel Stages)

```yaml
stages:
  - id: scan
    intent: "Scan the codebase and list all source files"

  - id: parallel-analysis
    type: fan-out
    split: "Split the file list into groups by directory"
    stages:
      - id: lint
        intent: "Run lint checks on these files"
      - id: complexity
        intent: "Calculate cyclomatic complexity for these files"
      - id: coverage
        intent: "Check test coverage for these files"
    merge: "Combine the lint, complexity, and coverage results into a unified report"

  - id: report
    intent: "Create a code health dashboard from the combined analysis"
```

#### Conditional Branching

```yaml
stages:
  - id: detect
    intent: "Detect the project type and framework"

  - id: route
    type: branch
    condition: "What framework was detected?"
    branches:
      next:
        intent: "Run Next.js-specific optimization checks"
      express:
        intent: "Run Express.js security audit"
      default:
        intent: "Run generic Node.js best practices check"

  - id: fix
    intent: "Apply the recommended fixes"
```

---

## 5. Pipeline Engine (`src/pipelines/`)

### 5.1 Architecture Overview

```
src/pipelines/
├── types.ts          # All type definitions (Pipeline, Stage, Context, etc.)
├── parser.ts         # CLI argument parser & YAML pipeline loader
├── engine.ts         # Core execution engine — orchestrates stages
├── context.ts        # Context creation, serialization, and transfer
├── manifest.ts       # Execution manifest recording & persistence
├── stages/
│   ├── standard.ts   # Standard stage executor (full agent loop)
│   ├── gate.ts       # Gate stage executor (conditional pass-through)
│   ├── tap.ts        # Tap stage executor (side-effect, no context mutation)
│   ├── transform.ts  # Transform stage executor (context reformatting)
│   ├── fan-out.ts    # Fan-out executor (parallel split)
│   └── fan-in.ts     # Fan-in executor (parallel merge)
├── recovery.ts       # Error recovery strategies
└── repl.ts           # REPL command handlers (/pipe, /pipeline)
```

### 5.2 Engine Execution Flow

```
getit pipe "stage 1" | "stage 2" | "stage 3"
    │
    ▼
┌─────────────────────────────────┐
│ 1. PARSE                        │
│    Parse CLI args or YAML file  │
│    Validate stage intents       │
│    Resolve variables            │
│    Build Pipeline object        │
└──────────────┬──────────────────┘
               ▼
┌─────────────────────────────────┐
│ 2. PLAN                         │
│    Display execution plan:      │
│    ┌──────────────────────────┐ │
│    │ Pipeline: 3 stages       │ │
│    │ ① find all TODO comments │ │
│    │ ② group by urgency       │ │
│    │ ③ create GitHub issues   │ │
│    │                          │ │
│    │ Est. time: ~2 min        │ │
│    │ [Run / Edit / Cancel]    │ │
│    └──────────────────────────┘ │
│    MITL gate: pipeline-level    │
│    approval before any stage    │
│    begins executing.            │
└──────────────┬──────────────────┘
               ▼
┌─────────────────────────────────┐
│ 3. EXECUTE (loop over stages)   │
│    For each stage:              │
│    a. Build stage context       │
│       (previous output + meta)  │
│    b. Create scoped AgentLoop   │
│    c. Inject intent as prompt   │
│    d. Run agent loop            │
│       (tool calls → MITL each)  │
│    e. Capture stage output      │
│    f. Record manifest entry     │
│    g. Check error/gate/timeout  │
│    h. Transfer context to next  │
└──────────────┬──────────────────┘
               ▼
┌─────────────────────────────────┐
│ 4. FINALIZE                     │
│    Write full manifest to disk  │
│    Update session memory        │
│    Display summary to user      │
│    Offer to save as YAML        │
└─────────────────────────────────┘
```

### 5.3 Stage Scoping

Each stage runs in an **isolated AgentLoop instance**. This is critical:

- **Context isolation:** Stage 2 doesn't see stage 1's internal tool calls, only its output. This prevents context window pollution and keeps each stage's reasoning focused.
- **Independent MITL:** Approving a tool call in stage 1 doesn't auto-approve anything in stage 2.
- **Clean failure boundaries:** If stage 2 fails, stage 1's state is unaffected and its output is preserved.

```typescript
// Simplified — see full implementation in §5.4
async function executeStage(
  stage: PipelineStage,
  incomingContext: StageContext,
  pipelineConfig: PipelineConfig
): Promise<StageResult> {
  // Create a fresh agent loop scoped to this stage
  const loop = new AgentLoop(buildStageSystemPrompt(stage, incomingContext));

  // Inject the stage intent with incoming context
  const prompt = buildStagePrompt(stage.intent, incomingContext);

  // Run with bounded iteration
  const result = await loop.runTurn(prompt, {
    maxIterations: stage.maxIterations ?? pipelineConfig.defaultMaxIterations,
    timeoutMs: (stage.timeout ?? pipelineConfig.defaultTimeout) * 1000,
  });

  // Extract structured output for next stage
  return captureStageOutput(loop, result, stage);
}
```

---

## 6. Stage Execution Model

### 6.1 Stage System Prompt

Each stage receives a tailored system prompt that:
1. Describes the stage's role in the pipeline
2. Injects the incoming context from the previous stage
3. Specifies output format expectations
4. Includes relevant project/workspace/preference context from Module B memory

```typescript
function buildStageSystemPrompt(
  stage: PipelineStage,
  context: StageContext,
  pipelineMeta: PipelineMeta
): string {
  return [
    `You are executing stage ${stage.index + 1} of ${pipelineMeta.totalStages} ` +
    `in a getit pipeline.`,
    ``,
    `## Your Task`,
    `${stage.intent}`,
    ``,
    `## Input from Previous Stage`,
    context.isEmpty
      ? `This is the first stage — no previous input. Work from the workspace directly.`
      : `\`\`\`\n${context.serialize()}\n\`\`\``,
    ``,
    `## Output Requirements`,
    `When you have completed the task, output your results clearly.`,
    `Structure your output so the next stage can understand and act on it.`,
    stage.nextStageHint
      ? `The next stage will: "${stage.nextStageHint}". Optimize your output format for that.`
      : ``,
    ``,
    `## Constraints`,
    `- Complete this task using the minimum number of tool calls.`,
    `- Do not ask clarifying questions — the intent is fully specified.`,
    `- If you cannot complete the task, explain why clearly.`,
  ].filter(Boolean).join('\n');
}
```

### 6.2 Output Capture

After a stage's agent loop completes, the engine extracts the stage's output to pass to the next stage. Output capture follows a priority hierarchy:

1. **Explicit capture block:** If the agent's final message contains a fenced code block labeled `output:`, that block is extracted as structured output.
2. **Final assistant message:** The last assistant message in the stage's conversation becomes the output.
3. **Tool results:** If the stage's value comes from tool execution (e.g., file content, command output), the relevant tool results are aggregated.

```typescript
interface CapturedOutput {
  /** The primary text output for the next stage. */
  text: string;
  /** Structured data if the agent produced JSON/structured output. */
  structured?: Record<string, unknown>;
  /** File references created or identified by this stage. */
  files?: FileReference[];
  /** Metadata about the execution. */
  meta: {
    toolCallCount: number;
    durationMs: number;
    modelUsed: string;
    tokensConsumed: { prompt: number; completion: number };
  };
}
```

### 6.3 Stage Types

#### 6.3.1 Standard Stage (default)

Full agent loop. Receives context, reasons about it, uses tools, produces output.

```yaml
- id: analyze
  intent: "Analyze test coverage and identify untested code paths"
```

#### 6.3.2 Gate Stage (`|?` or `type: gate`)

Evaluates a condition against the incoming context. If the condition is met, passes context through unchanged. If not, the pipeline halts (or skips to a specified stage).

The gate does NOT use tools — it's a pure LLM reasoning step that outputs `PASS` or `FAIL` with a reason.

```yaml
- id: check-threshold
  type: gate
  intent: "Are there more than 5 critical issues?"
  on_fail: skip-to:report  # Optional — default is halt pipeline
```

```typescript
async function executeGateStage(
  stage: PipelineStage,
  context: StageContext
): Promise<GateResult> {
  const prompt = [
    `Evaluate this condition against the provided context.`,
    `Condition: ${stage.intent}`,
    `Context:\n${context.serialize()}`,
    ``,
    `Respond with exactly one line:`,
    `PASS: <reason> — if the condition IS met`,
    `FAIL: <reason> — if the condition IS NOT met`,
  ].join('\n');

  const response = await singleShotLLM(prompt);
  const passed = response.trim().startsWith('PASS');

  return {
    passed,
    reason: response.trim().replace(/^(PASS|FAIL):\s*/, ''),
    context: passed ? context : null,  // Pass through or halt
  };
}
```

#### 6.3.3 Tap Stage (`|>` or `type: tap`)

Executes a side effect (logging, notifications, analytics) without modifying the pipeline context. The incoming context passes through to the next stage unchanged — the tap's output is discarded from the main flow.

```yaml
- id: notify
  type: tap
  intent: "Send a Slack notification summarizing the findings"
```

#### 6.3.4 Transform Stage (`|!` or `type: transform`)

A lightweight reasoning-only stage that reformats context without using tools. Used to reshape data between stages that expect different formats.

```yaml
- id: extract-paths
  type: transform
  intent: "Extract only the file paths from the analysis results, one per line"
```

#### 6.3.5 Fan-Out Stage (`type: fan-out`)

Splits the incoming context into partitions and runs sub-pipelines in parallel (or sequential with concurrent output collection). Each partition receives a subset of the context.

```yaml
- id: parallel-scan
  type: fan-out
  split: "Split the file list by top-level directory"
  stages:
    - id: lint
      intent: "Run lint analysis"
    - id: security
      intent: "Run security scan"
  merge: "Combine all results into a unified report sorted by severity"
```

Fan-out execution:
1. The `split` intent is evaluated to partition the incoming context
2. Each sub-pipeline runs against each partition (or the same context for parallel analysis paths)
3. The `merge` intent combines all results into a single output context

**Parallelism model:** Fan-out stages run sub-pipelines sequentially by default (to respect terminal I/O for MITL). With `--parallel` flag or `parallel: true` in YAML, sub-pipelines run concurrently with MITL prompts queued.

---

## 7. Inter-Stage Data Protocol

### 7.1 StageContext Object

The `StageContext` is the fundamental data unit flowing between stages. It's designed to be LLM-readable while preserving structure for programmatic access.

```typescript
interface StageContext {
  /** Unique context ID for tracing. */
  id: string;
  /** The stage that produced this context. */
  sourceStageId: string;
  /** Timestamp of creation. */
  createdAt: string;
  /** Primary text content — the "message" between stages. */
  text: string;
  /**
   * Structured data extracted or produced by the stage.
   * Can be arrays, objects, or any JSON-serializable value.
   * The next stage receives this as part of its system prompt context.
   */
  data?: unknown;
  /**
   * File references — paths to files created, modified, or identified.
   * Allows the next stage to operate on specific files without re-scanning.
   */
  files?: FileReference[];
  /**
   * Annotations — metadata tags added by the stage for downstream consumption.
   * Example: { "issue_count": 42, "severity_distribution": { "critical": 5, "high": 12 } }
   */
  annotations?: Record<string, unknown>;
  /**
   * The raw conversation history from the producing stage.
   * NOT passed to the next stage by default (context isolation).
   * Available via /pipe inspect for debugging.
   */
  _rawHistory?: ChatMessage[];
}

interface FileReference {
  path: string;
  role: 'created' | 'modified' | 'read' | 'identified';
  snippet?: string;  // First 500 chars for context
}
```

### 7.2 Context Serialization

When injected into the next stage's prompt, the context is serialized intelligently:

```typescript
function serializeContext(ctx: StageContext, maxChars: number = 8000): string {
  const parts: string[] = [];

  // Always include text
  parts.push(ctx.text);

  // Include structured data if present
  if (ctx.data) {
    const dataStr = JSON.stringify(ctx.data, null, 2);
    if (dataStr.length <= maxChars * 0.5) {
      parts.push(`\n---\nStructured Data:\n\`\`\`json\n${dataStr}\n\`\`\``);
    } else {
      // Summarize large data
      parts.push(`\n---\n[Structured data: ${typeof ctx.data === 'object' ? Object.keys(ctx.data as object).length + ' keys' : 'available'} — truncated for context window]`);
    }
  }

  // Include file references
  if (ctx.files && ctx.files.length > 0) {
    parts.push(`\n---\nFiles:\n${ctx.files.map(f => `- [${f.role}] ${f.path}`).join('\n')}`);
  }

  // Include annotations
  if (ctx.annotations && Object.keys(ctx.annotations).length > 0) {
    parts.push(`\n---\nAnnotations: ${JSON.stringify(ctx.annotations)}`);
  }

  let result = parts.join('\n');

  // Truncate if exceeding budget
  if (result.length > maxChars) {
    result = result.slice(0, maxChars - 100) +
      `\n\n[... context truncated at ${maxChars} chars. ${result.length - maxChars} chars omitted.]`;
  }

  return result;
}
```

### 7.3 Context Size Management

Large contexts (e.g., scanning an entire codebase) can exceed the LLM's context window. The engine applies progressive strategies:

| Context Size | Strategy |
|---|---|
| ≤ 8,000 chars | Pass through directly |
| 8,001 – 32,000 chars | Summarize with a dedicated LLM call before passing |
| 32,001 – 128,000 chars | Write to temp file, pass file reference + summary |
| > 128,000 chars | Write to temp file, extract key statistics, pass reference + stats |

```typescript
async function prepareContextForNextStage(
  ctx: StageContext,
  config: PipelineConfig
): Promise<StageContext> {
  const serialized = serializeContext(ctx, Infinity);
  const charLimit = config.contextBudget ?? 8000;

  if (serialized.length <= charLimit) {
    return ctx;
  }

  if (serialized.length <= 32000) {
    // Summarize
    const summary = await singleShotLLM(
      `Summarize the following data concisely, preserving all key facts, ` +
      `numbers, file paths, and actionable items:\n\n${serialized}`
    );
    return { ...ctx, text: summary, annotations: { ...ctx.annotations, _summarized: true } };
  }

  // Write to temp file and pass reference
  const tempPath = await writeContextToTempFile(ctx);
  return {
    ...ctx,
    text: `[Context written to ${tempPath} — ${serialized.length} chars. ` +
      `Use file tools to read specific sections as needed.]`,
    files: [...(ctx.files ?? []), { path: tempPath, role: 'created' }],
    annotations: { ...ctx.annotations, _externalized: true, _tempPath: tempPath },
  };
}
```

---

## 8. MITL Integration

### 8.1 Three-Layer Approval Model

NL Pipelines introduce a **three-layer MITL model**:

| Layer | When | What the User Sees |
|---|---|---|
| **Pipeline-level** | Before execution begins | Full pipeline plan with all stages, estimated time, and variables |
| **Stage-level** | Before each stage starts (optional) | Stage intent, incoming context preview, tools likely needed |
| **Step-level** | During stage execution | Standard MITL gate on each tool call (existing v2.0 behavior) |

By default, pipeline-level and step-level gates are active. Stage-level gates can be enabled with `--confirm-stages` or `mitl: per-stage` in YAML.

### 8.2 Pipeline-Level Approval Card

```
╭──────────────────────────────────────────────────────╮
│  📋 PIPELINE: 3 stages                              │
│──────────────────────────────────────────────────────│
│  ① find all TODO comments in src/                    │
│  ② group by urgency and categorize                   │
│  ③ create GitHub issues for critical ones             │
│                                                      │
│  Variables:                                          │
│    source_dir = "src/"                               │
│    severity   = "high"                               │
│                                                      │
│  Est. time: ~2–4 min  │  Max tool calls: 30          │
│                                                      │
│  [Y] Run  [n] Cancel  [e] Edit stages  [i] Inspect   │
╰──────────────────────────────────────────────────────╯
```

The `[e] Edit` option opens the pipeline in the multi-line editor (Module H) where stages can be reworded, reordered, or removed before execution.

The `[i] Inspect` option shows detailed stage-by-stage analysis (which tools each stage might use, estimated complexity).

### 8.3 Stage Transition Card

When `--confirm-stages` is active, between each stage:

```
╭──────────────────────────────────────────────────────╮
│  ▶ Stage 2 of 3: "group by urgency"                 │
│──────────────────────────────────────────────────────│
│  Input from stage 1 (317 chars):                     │
│  ┌────────────────────────────────────────────────┐  │
│  │ Found 23 TODO comments across 8 files:         │  │
│  │ - src/agent/loop.ts:42  TODO: add timeout...   │  │
│  │ - src/mitl/interceptor.ts:89  FIXME: handle... │  │
│  │ ... (20 more)                                  │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  [Y] Continue  [n] Stop here  [e] Edit intent        │
│  [s] Skip this stage  [j] Jump to stage:___          │
╰──────────────────────────────────────────────────────╯
```

### 8.4 MITL Context Type

Adds a new `InterceptionContext` variant for the existing MITL system:

```typescript
// Extension to src/mitl/interceptor.ts
export type InterceptionContext =
  | 'BASH'
  | 'FILE CREATE'
  | 'FILE PATCH'
  | 'PLUGIN'
  | 'PLUGIN SYSTEM'
  | 'RECIPE STEP'
  | 'WATCH ACTION'
  | 'PIPELINE PLAN'      // NEW — pipeline-level approval
  | 'PIPELINE STAGE'     // NEW — stage-level approval (optional)
  | 'PIPELINE TOOL';     // NEW — tool call within a pipeline stage
```

---

## 9. Branching, Conditionals & Control Flow

### 9.1 Linear Pipelines (Default)

Most pipelines are linear: stage 1 → stage 2 → stage 3. This is the default behavior of the `|` operator.

### 9.2 Conditional Stages

Any stage can have a `when` clause that's evaluated against the incoming context:

```yaml
- id: create-issues
  intent: "Create GitHub issues for critical items"
  when: "context contains items with severity 'critical'"
```

The `when` clause is evaluated by the LLM as a boolean — it receives the incoming context and the condition, and returns `true` or `false`. If false, the stage is skipped and context passes through unchanged.

### 9.3 Branching (`type: branch`)

Branch stages route execution to different sub-pipelines based on context:

```yaml
- id: route-by-language
  type: branch
  condition: "What is the primary programming language?"
  branches:
    typescript:
      - intent: "Run tsc --noEmit for type checking"
      - intent: "Run eslint with TypeScript parser"
    python:
      - intent: "Run mypy for type checking"
      - intent: "Run ruff for linting"
    default:
      - intent: "Run generic code quality checks"
```

Branch execution:
1. The `condition` is evaluated by the LLM against incoming context
2. The LLM responds with a branch key
3. The matching branch's stages execute sequentially
4. If no branch matches, `default` runs (if defined), otherwise pipeline halts with error

### 9.4 Loops (`type: loop`)

Loop stages repeat until a condition is met:

```yaml
- id: iterative-fix
  type: loop
  intent: "Fix the next failing test"
  until: "All tests pass"
  max_iterations: 5
```

Loop execution:
1. Run the intent as a standard stage
2. Evaluate the `until` condition against the stage output
3. If condition met → exit loop, pass context forward
4. If not → re-run with updated context (previous attempt's output)
5. Hard cap at `max_iterations` (default: 3)

### 9.5 Early Termination

Any stage can halt the entire pipeline:

```yaml
- id: safety-check
  intent: "Check if the deployment target is a production environment"
  type: gate
  on_fail: halt
  halt_message: "Pipeline aborted: deployment target is production. Use --force to override."
```

---

## 10. Error Handling & Recovery

### 10.1 Error Categories

| Category | Example | Default Behavior |
|---|---|---|
| **Stage Failure** | Agent couldn't complete intent | Halt pipeline, show error + partial results |
| **Tool Error** | Command returned non-zero | Handled by stage's agent (may retry or adapt) |
| **MITL Denial** | User rejected a tool call | Stage fails, pipeline halts |
| **Timeout** | Stage exceeded time limit | Stage fails, pipeline halts |
| **Context Overflow** | Output too large for next stage | Auto-summarize (§7.3) |
| **LLM Error** | API timeout, rate limit | Retry with exponential backoff (3 attempts) |

### 10.2 Recovery Strategies

Per-stage recovery can be configured:

```yaml
- id: risky-stage
  intent: "Apply the automated refactoring"
  on_failure: retry      # retry | skip | halt | fallback
  max_retries: 2
  fallback_intent: "Log the failed refactoring for manual review"
```

| Strategy | Behavior |
|---|---|
| `halt` (default) | Stop pipeline, report error, preserve partial results |
| `retry` | Re-run the stage with error context appended ("Previous attempt failed because…") |
| `skip` | Skip this stage, pass previous context through unchanged |
| `fallback` | Run `fallback_intent` as an alternative stage |

### 10.3 Partial Result Preservation

When a pipeline fails mid-execution, all completed stages' results are preserved:

```
╭──────────────────────────────────────────────────────╮
│  ⚠ PIPELINE FAILED at stage 3 of 4                  │
│──────────────────────────────────────────────────────│
│  ✅ Stage 1: "find all TODO comments" (2.3s)        │
│  ✅ Stage 2: "group by urgency" (1.8s)              │
│  ❌ Stage 3: "create GitHub issues" — MITL denied    │
│  ⏭ Stage 4: "summarize" — skipped                   │
│                                                      │
│  Partial results saved to:                           │
│  ~/.local/state/getit/pipelines/run_2025abc.json    │
│                                                      │
│  [r] Resume from stage 3  [i] Inspect results        │
│  [s] Save partial  [d] Discard                       │
╰──────────────────────────────────────────────────────╯
```

### 10.4 Pipeline Resumption

Failed or interrupted pipelines can be resumed:

```bash
getit pipe --resume run_2025abc
getit pipe --resume run_2025abc --from stage-3
```

The engine reloads the manifest, restores context from the last successful checkpoint, and continues execution.

---

## 11. Pipeline Memory & Persistence

### 11.1 Execution Manifests

Every pipeline run produces an immutable manifest stored in `~/.local/state/getit/pipelines/`:

```typescript
interface PipelineManifest {
  /** Unique run ID. */
  runId: string;
  /** Pipeline name (if saved) or "ad-hoc". */
  pipelineName: string;
  /** SHA-256 hash of the pipeline definition. */
  definitionHash: string;
  /** Timestamp of execution start. */
  startedAt: string;
  /** Timestamp of execution end (or failure). */
  endedAt: string;
  /** Overall status. */
  status: 'completed' | 'failed' | 'interrupted' | 'partial';
  /** Variable values used. */
  variables: Record<string, unknown>;
  /** Per-stage execution records. */
  stages: StageManifestEntry[];
  /** Aggregate metrics. */
  metrics: {
    totalDurationMs: number;
    totalToolCalls: number;
    totalTokens: { prompt: number; completion: number };
    totalMitlApprovals: number;
    totalMitlDenials: number;
  };
}

interface StageManifestEntry {
  stageId: string;
  intent: string;
  type: StageType;
  status: 'completed' | 'failed' | 'skipped' | 'timeout';
  startedAt: string;
  endedAt: string;
  durationMs: number;
  toolCalls: number;
  tokensUsed: { prompt: number; completion: number };
  modelUsed: string;
  /** The output context produced by this stage. */
  output: StageContext;
  /** Error details if status is 'failed'. */
  error?: { message: string; recoveryAttempted?: string };
}
```

### 11.2 Pipeline History

The pipeline engine integrates with Module B (Session Memory) to record pipeline executions in the session history. This allows the agent to reference past pipeline runs:

```
You ran "todo-to-issues" 3 days ago — it found 23 TODOs and created 5 issues.
Since then, 2 new TODO comments have been added.
```

### 11.3 Smart Suggestions

Based on pipeline history, the engine can suggest:
- **Re-runs:** "You last ran `todo-to-issues` 7 days ago. Run again?"
- **Optimizations:** "Stage 2 consistently takes 80% of the pipeline time. Consider splitting it."
- **Promotions:** "You've run this ad-hoc pipeline 3 times. Save it as a named pipeline?"

---

## 12. TUI Integration

### 12.1 Pipeline Progress Dashboard

During execution, the TUI (Module E + G) displays a real-time pipeline progress view:

```
╭─ Pipeline: todo-to-issues ──────────────────────────╮
│                                                      │
│  ✅ ① find TODOs ─── 2.3s ─── 23 items found       │
│  ⏳ ② group by urgency ─── running (1.2s)...       │
│  ○  ③ create issues                                 │
│  ○  ④ summarize                                     │
│                                                      │
│  Context flow: 1.2 KB → [processing] → ? → ?        │
│  Tool calls: 4/30  │  Tokens: 2,341                 │
│                                                      │
│  ┌── Stage 2 Live ──────────────────────────────┐    │
│  │ Analyzing 23 TODO items...                   │    │
│  │ Categorized: 5 critical, 12 high, 6 medium   │    │
│  └──────────────────────────────────────────────┘    │
╰──────────────────────────────────────────────────────╯
```

### 12.2 Context Flow Visualization

The `/pipe flow` command shows the data flow through the pipeline:

```
╭─ Context Flow ──────────────────────────────────────╮
│                                                      │
│  Stage 1 ──[1.2 KB]──▶ Stage 2 ──[3.4 KB]──▶ ...  │
│  "find"                "group"                       │
│                                                      │
│  Annotations flowing:                                │
│    issue_count: 23 → 23 (unchanged)                 │
│    severity_dist: → { critical: 5, high: 12, ... }  │
│    files_touched: 8 → 8 (unchanged)                 │
│                                                      │
╰──────────────────────────────────────────────────────╯
```

### 12.3 Undo Timeline Integration

Pipeline stages integrate with Module H's undo timeline. If a pipeline modifies files, each stage is a discrete checkpoint in the undo timeline, allowing the user to rewind individual stages.

---

## 13. Plugin Interop

### 13.1 Pipeline-Aware Plugins

Plugins (Module A) can declare pipeline capabilities:

```typescript
// .getit/tools/github-issues.ts
export default {
  name: 'create_github_issues',
  description: 'Batch-create GitHub issues from structured data',
  parameters: { /* ... */ },
  risk: 'write',
  execute: async (args) => { /* ... */ },

  // NEW: Pipeline integration
  pipeline: {
    /** This plugin prefers to receive context as JSON with these fields. */
    preferredInputSchema: {
      items: [{ title: 'string', body: 'string', labels: 'string[]' }]
    },
    /** This plugin produces output in this shape. */
    outputSchema: {
      created: [{ number: 'number', url: 'string' }]
    },
  }
};
```

When a pipeline stage's agent selects a pipeline-aware plugin, the engine can pre-format the incoming context to match the plugin's preferred input schema, reducing LLM token usage.

### 13.2 Pipeline Plugins (Custom Stage Types)

Plugins can register entirely new stage types:

```typescript
// .getit/tools/parallel-lint-stage.ts
export default {
  name: 'parallel_lint',
  description: 'Run ESLint across files in parallel batches',
  parameters: { /* ... */ },
  risk: 'read',
  execute: async (args) => { /* ... */ },

  // Register as a pipeline stage type
  stageType: {
    name: 'parallel-lint',
    /** Custom executor — bypasses the standard agent loop. */
    execute: async (context: StageContext, config: StageConfig) => {
      // Custom logic — direct execution without LLM
      return { text: 'Lint results...', data: { /* ... */ } };
    }
  }
};
```

Usage in a pipeline:
```yaml
- id: lint
  type: parallel-lint  # Uses the plugin's custom executor
  config:
    concurrency: 4
    fix: true
```

---

## 14. Recipe Interop

### 14.1 Recipes as Pipeline Stages

A recipe can be invoked as a pipeline stage using the `recipe:` prefix:

```bash
getit pipe "analyze test coverage" | recipe:fix-coverage-gaps | "verify all tests pass"
```

```yaml
- id: fix-gaps
  type: recipe
  recipe: fix-coverage-gaps
  variables:
    min_coverage: "80%"
```

The recipe executes as a sub-pipeline — all its steps run within the stage's scope, and the recipe's final output becomes the stage's output.

### 14.2 Pipeline Recording → Recipe Promotion

Ad-hoc pipelines can be promoted to recipes for even tighter integration:

```bash
getit pipe --record "find security issues" | "fix the critical ones" | "run tests"

# After execution:
# > Pipeline completed. Save as recipe? [y/N]
# > Recipe saved to .getit/recipes/security-fix-pipeline.yaml
```

The recorded pipeline YAML is automatically converted to recipe format, with each stage becoming a recipe step.

---

## 15. CLI Commands & REPL Surface

### 15.1 CLI Commands

| Command | Description |
|---|---|
| `getit pipe <intents...>` | Run an ad-hoc pipeline from CLI |
| `getit pipe --file <path>` | Run a saved YAML pipeline |
| `getit pipe --resume <run-id>` | Resume a failed/interrupted pipeline |
| `getit pipe --list` | List saved pipelines |
| `getit pipe --history` | Show recent pipeline execution history |
| `getit pipe --inspect <run-id>` | Inspect a completed pipeline's manifest |
| `getit pipe --dry-run <intents...>` | Show execution plan without running |

### 15.2 REPL Slash Commands

| Command | Action |
|---|---|
| `/pipe <intents...>` | Start a pipeline from the REPL |
| `/pipe file <name>` | Run a saved pipeline |
| `/pipe list` | List available pipelines |
| `/pipe history` | Show execution history |
| `/pipe inspect [run-id]` | Inspect last (or specified) pipeline run |
| `/pipe resume [run-id]` | Resume last failed pipeline |
| `/pipe save <name>` | Save the last ad-hoc pipeline as YAML |
| `/pipe flow` | Show context flow visualization for last run |
| `/pipe edit <name>` | Open a saved pipeline in the multi-line editor |
| `/pipe delete <name>` | Delete a saved pipeline |

### 15.3 REPL Interactive Pipeline Builder

```
getit-agent ❯ /pipe build
📋 Interactive Pipeline Builder. Type stages one at a time. Type /done when finished.

Stage 1 ❯ find all deprecated API calls in the codebase
Stage 2 ❯ categorize by replacement availability
Stage 3 ❯ auto-fix the ones with known replacements
Stage 4 ❯ create issues for the ones that need manual intervention
Stage 5 ❯ /done

Pipeline (4 stages):
  ① find all deprecated API calls in the codebase
  ② categorize by replacement availability
  ③ auto-fix the ones with known replacements
  ④ create issues for the ones that need manual intervention

[R] Run  [E] Edit  [S] Save as YAML  [C] Cancel
```

---

## 16. Configuration (`.getitrc` & `.getit/pipelines/`)

### 16.1 `.getitrc` Pipeline Settings

```ini
# Pipeline defaults
GETIT_PIPE_DEFAULT_TIMEOUT=120         # Per-stage timeout in seconds
GETIT_PIPE_MAX_TOOL_CALLS=10          # Max tool calls per stage
GETIT_PIPE_CONTEXT_BUDGET=8000        # Max chars passed between stages
GETIT_PIPE_CONFIRM_STAGES=false       # Stage-level MITL gate
GETIT_PIPE_MANIFEST_DIR=              # Custom manifest directory (default: ~/.local/state/getit/pipelines)
GETIT_PIPE_DEFAULT_MODEL=             # Override model for pipeline stages (default: use carrier settings)
GETIT_PIPE_PARALLEL_FANOUT=false      # Enable parallel fan-out execution
GETIT_PIPE_AUTO_SAVE_THRESHOLD=3      # Prompt to save after N ad-hoc runs of same pipeline
```

### 16.2 Pipeline Directory Structure

```
.getit/
├── pipelines/                      # Saved pipeline definitions
│   ├── todo-to-issues.yaml
│   ├── deploy-staging.yaml
│   └── security-audit.yaml
├── tools/                          # Plugins (existing v2.0)
├── recipes/                        # Recipes (existing v2.0)
└── themes/                         # UI themes (existing v2.0)

~/.config/getit/
├── pipelines/                      # Global pipeline definitions
│   └── my-global-pipeline.yaml
└── ...

~/.local/state/getit/
├── pipelines/                      # Execution manifests
│   ├── run_2025_01_15_abc123.json
│   ├── run_2025_01_16_def456.json
│   └── ...
└── sessions/                       # Session memory (existing v2.0)
```

---

## 17. Security Model

### 17.1 Pipeline-Specific Security Considerations

| Threat | Mitigation |
|---|---|
| **Stage prompt injection** | Each stage runs in an isolated AgentLoop. A malicious stage output cannot modify previous stages or the pipeline definition. |
| **Context exfiltration** | The env scrubber (existing) runs on all context transfers between stages. Secrets detected in stage output are redacted before passing to the next stage. |
| **Runaway pipelines** | Hard caps: max stages (20), max tool calls per stage (configurable), max total tool calls (configurable), max duration per stage (configurable). |
| **Recursive pipelines** | Pipelines cannot invoke other pipelines (no nesting beyond fan-out). Recipe stages are the only sub-pipeline mechanism, and they cannot invoke pipelines. |
| **MITL bypass** | Pipeline-level approval cannot be disabled. Step-level MITL within stages uses the existing interceptor — no new bypass paths. |
| **Context overflow attack** | A stage that produces massive output to overwhelm the next stage's LLM context is mitigated by context size management (§7.3). |

### 17.2 Security Policy Extensions

```typescript
// Extension to src/security/policy.ts
interface PipelineSecurityPolicy {
  /** Maximum number of stages in a single pipeline. */
  maxStages: number;               // Default: 20
  /** Maximum total tool calls across all stages. */
  maxTotalToolCalls: number;       // Default: 100
  /** Maximum pipeline duration in seconds. */
  maxDurationSeconds: number;      // Default: 600 (10 min)
  /** Whether fan-out parallelism is allowed. */
  allowParallelFanout: boolean;    // Default: false (sequential)
  /** Whether pipeline resumption is allowed. */
  allowResumption: boolean;        // Default: true
  /** Directories that pipeline stages cannot access. */
  blockedPaths: string[];          // Inherits from existing path policy
}
```

---

## 18. File Layout & Project Structure

### 18.1 New Files (v2.1)

```
src/pipelines/
├── types.ts              # ~200 lines — All pipeline type definitions
├── parser.ts             # ~250 lines — CLI & YAML pipeline parsing
├── engine.ts             # ~400 lines — Core orchestration engine
├── context.ts            # ~180 lines — Context creation & transfer
├── manifest.ts           # ~150 lines — Manifest recording & persistence
├── stages/
│   ├── standard.ts       # ~120 lines — Standard agent-loop stage
│   ├── gate.ts           # ~80 lines  — Conditional gate stage
│   ├── tap.ts            # ~60 lines  — Side-effect tap stage
│   ├── transform.ts      # ~70 lines  — Context transform stage
│   ├── fan-out.ts        # ~200 lines — Fan-out/fan-in executor
│   └── branch.ts         # ~120 lines — Conditional branch executor
├── recovery.ts           # ~100 lines — Error recovery strategies
└── repl.ts               # ~150 lines — REPL slash command handlers

tests/
├── pipeline-parser.test.ts    # Parser unit tests
├── pipeline-engine.test.ts    # Engine integration tests
├── pipeline-context.test.ts   # Context serialization tests
├── pipeline-stages.test.ts    # Stage executor tests
├── pipeline-mitl.test.ts      # MITL integration tests
├── pipeline-recovery.test.ts  # Recovery strategy tests
└── pipeline-manifest.test.ts  # Manifest persistence tests
```

**Estimated total: ~1,880 lines of source + ~1,200 lines of tests.**

### 18.2 Modified Files

| File | Change |
|---|---|
| `src/agent/tools.ts` | Register pipeline-related tool schemas |
| `src/agent/prompt.ts` | Add pipeline context to system prompt when inside a stage |
| `src/mitl/interceptor.ts` | Add `PIPELINE PLAN`, `PIPELINE STAGE`, `PIPELINE TOOL` context types |
| `src/repl/control-plane/classifier.ts` | Classify `/pipe` commands |
| `src/runtime/session.ts` | Add pipeline execution state fields |
| `src/memory/sessions.ts` | Record pipeline runs in session history |
| `src/ui/dashboard.ts` | Add pipeline progress pane |
| `README.md` | Document pipeline feature |
| `CHANGELOG.md` | v2.1.0 entry |
| `package.json` | Version bump to 2.1.0 |

---

## 19. Type Definitions (`src/pipelines/types.ts`)

```typescript
/**
 * @module pipelines/types
 * @description Type definitions for the getit v2.1 Natural Language Pipelines system.
 *
 * NL Pipelines chain semantic intents through MITL-gated agent loops,
 * where each stage's output becomes the next stage's input context.
 */

// ─── Stage Types ───────────────────────────────────────────────

/**
 * All supported stage types.
 */
export type StageType =
  | 'standard'    // Full agent loop (default)
  | 'gate'        // Conditional pass-through
  | 'tap'         // Side-effect, no context mutation
  | 'transform'   // Lightweight context reformatting (no tools)
  | 'fan-out'     // Parallel split
  | 'branch'      // Conditional routing
  | 'loop'        // Repeat until condition
  | 'recipe';     // Delegate to a recipe

/**
 * Recovery strategies when a stage fails.
 */
export type RecoveryStrategy = 'halt' | 'retry' | 'skip' | 'fallback';

// ─── Pipe Operators ────────────────────────────────────────────

/**
 * Pipe operator types parsed from CLI syntax.
 */
export type PipeOperator =
  | 'pipe'        // | — standard context transfer
  | 'tap'         // |> — side-effect, context passes through
  | 'gate'        // |? — conditional pass-through
  | 'transform';  // |! — context reformatting

// ─── Stage Definitions ─────────────────────────────────────────

/**
 * A single pipeline stage definition.
 */
export interface PipelineStage {
  /** Unique stage identifier. Auto-generated from intent if not specified. */
  id: string;
  /** Human-readable stage index (0-based). */
  index: number;
  /** The natural language intent for this stage. */
  intent: string;
  /** Stage execution type. Default: 'standard'. */
  type: StageType;
  /** Timeout in seconds. Inherits from pipeline config if not set. */
  timeout?: number;
  /** Maximum tool call iterations within this stage. */
  maxIterations?: number;
  /** Recovery strategy on failure. Default: 'halt'. */
  onFailure?: RecoveryStrategy;
  /** Max retries (only when onFailure === 'retry'). Default: 2. */
  maxRetries?: number;
  /** Fallback intent (only when onFailure === 'fallback'). */
  fallbackIntent?: string;
  /** Conditional execution — LLM evaluates against incoming context. */
  when?: string;
  /** MITL behavior for this stage: 'normal' | 'per-item' | 'auto' (read-only stages). */
  mitl?: 'normal' | 'per-item' | 'auto';
  /** Override model for this stage (e.g., use a cheaper model for simple transforms). */
  model?: string;
  /** Hint about what the next stage does — helps optimize output format. */
  nextStageHint?: string;

  // ─── Type-specific fields ──────────────────────

  /** For gate stages: what to do on fail. */
  onGateFail?: 'halt' | `skip-to:${string}`;
  /** For gate stages: custom halt message. */
  haltMessage?: string;
  /** For branch stages: the branching condition. */
  branchCondition?: string;
  /** For branch stages: named branch definitions. */
  branches?: Record<string, PipelineStage[]>;
  /** For loop stages: termination condition. */
  until?: string;
  /** For loop stages: max iterations. Default: 3. */
  loopMaxIterations?: number;
  /** For fan-out stages: split strategy intent. */
  splitIntent?: string;
  /** For fan-out stages: sub-pipeline definitions. */
  fanOutStages?: PipelineStage[];
  /** For fan-out stages: merge strategy intent. */
  mergeIntent?: string;
  /** For fan-out stages: whether to run in parallel. */
  parallel?: boolean;
  /** For recipe stages: recipe name to invoke. */
  recipeName?: string;
  /** For recipe stages: variable overrides. */
  recipeVariables?: Record<string, unknown>;
}

// ─── Pipeline Definition ───────────────────────────────────────

/**
 * A variable definition for parameterized pipelines.
 */
export interface PipelineVariable {
  description: string;
  default?: unknown;
  type?: 'string' | 'number' | 'boolean';
  required?: boolean;
  enum?: string[];
}

/**
 * A complete pipeline definition — either parsed from CLI args or loaded from YAML.
 */
export interface Pipeline {
  /** Pipeline name. 'ad-hoc' for CLI-defined pipelines. */
  name: string;
  /** Semantic version (for saved pipelines). */
  version?: string;
  /** Human-readable description. */
  description?: string;
  /** Author identifier. */
  author?: string;
  /** Parameterized variables. */
  variables?: Record<string, PipelineVariable>;
  /** Ordered sequence of stages. */
  stages: PipelineStage[];
  /** Pipeline-level configuration overrides. */
  config?: PipelineConfig;
}

/**
 * Pipeline execution configuration.
 */
export interface PipelineConfig {
  /** Default timeout per stage (seconds). Default: 120. */
  defaultTimeout: number;
  /** Default max tool call iterations per stage. Default: 10. */
  defaultMaxIterations: number;
  /** Max chars of context passed between stages. Default: 8000. */
  contextBudget: number;
  /** Whether to show stage-level MITL gates. Default: false. */
  confirmStages: boolean;
  /** Whether to enable parallel fan-out. Default: false. */
  parallelFanout: boolean;
  /** Override model for all stages. */
  defaultModel?: string;
}

// ─── Context ───────────────────────────────────────────────────

/**
 * Reference to a file identified or produced by a stage.
 */
export interface FileReference {
  path: string;
  role: 'created' | 'modified' | 'read' | 'identified';
  snippet?: string;
}

/**
 * The semantic data unit flowing between pipeline stages.
 */
export interface StageContext {
  /** Unique context ID for tracing. */
  id: string;
  /** The stage that produced this context. */
  sourceStageId: string;
  /** Timestamp of creation. */
  createdAt: string;
  /** Primary text content — the main output for the next stage. */
  text: string;
  /** Structured data (JSON-serializable). */
  data?: unknown;
  /** File references produced or identified. */
  files?: FileReference[];
  /** Metadata annotations for downstream stages. */
  annotations?: Record<string, unknown>;
}

// ─── Execution Results ─────────────────────────────────────────

/**
 * Result of executing a single pipeline stage.
 */
export interface StageResult {
  stageId: string;
  type: StageType;
  status: 'completed' | 'failed' | 'skipped' | 'timeout' | 'gate-fail';
  durationMs: number;
  toolCalls: number;
  tokensUsed: { prompt: number; completion: number };
  modelUsed: string;
  output: StageContext;
  error?: { message: string; recoveryAttempted?: RecoveryStrategy };
}

/**
 * Gate-specific result extension.
 */
export interface GateResult {
  passed: boolean;
  reason: string;
  context: StageContext | null;
}

/**
 * Result of executing an entire pipeline.
 */
export interface PipelineResult {
  runId: string;
  pipelineName: string;
  status: 'completed' | 'failed' | 'interrupted' | 'partial';
  startedAt: string;
  endedAt: string;
  totalDurationMs: number;
  stages: StageResult[];
  metrics: PipelineMetrics;
}

/**
 * Aggregate pipeline execution metrics.
 */
export interface PipelineMetrics {
  totalToolCalls: number;
  totalTokens: { prompt: number; completion: number };
  totalMitlApprovals: number;
  totalMitlDenials: number;
  stagesCompleted: number;
  stagesFailed: number;
  stagesSkipped: number;
}

// ─── Manifest ──────────────────────────────────────────────────

/**
 * Immutable execution manifest for audit and resumption.
 */
export interface PipelineManifest {
  runId: string;
  pipelineName: string;
  definitionHash: string;
  pipeline: Pipeline;
  startedAt: string;
  endedAt: string;
  status: PipelineResult['status'];
  variables: Record<string, unknown>;
  stages: StageManifestEntry[];
  metrics: PipelineMetrics;
}

/**
 * Per-stage entry in the execution manifest.
 */
export interface StageManifestEntry {
  stageId: string;
  intent: string;
  type: StageType;
  status: StageResult['status'];
  startedAt: string;
  endedAt: string;
  durationMs: number;
  toolCalls: number;
  tokensUsed: { prompt: number; completion: number };
  modelUsed: string;
  inputContextId: string;
  outputContextId: string;
  error?: { message: string; recoveryAttempted?: string };
}
```

---

## 20. Acceptance Test Matrix

| ID | Test | Stage Type | Validates |
|---|---|---|---|
| **PIPE_001** | Parse 3-stage inline pipeline from CLI args | — | Parser correctly splits `\|`-separated intents |
| **PIPE_002** | Parse pipeline with named stages (`name:"intent"`) | — | Parser extracts stage names |
| **PIPE_003** | Parse pipeline with `\|>`, `\|?`, `\|!` operators | — | Parser assigns correct stage types |
| **PIPE_004** | Load and validate YAML pipeline file | — | YAML parser handles all fields |
| **PIPE_005** | Variable resolution in stage intents (`{{var}}`) | — | Template variables resolve correctly |
| **PIPE_006** | Execute 2-stage linear pipeline | standard | Context flows from stage 1 to stage 2 |
| **PIPE_007** | Execute 3-stage pipeline with tool calls | standard | MITL fires for each tool call in each stage |
| **PIPE_008** | Stage isolation — stage 2 cannot see stage 1's tool history | standard | Context isolation verified |
| **PIPE_009** | Gate stage passes context when condition met | gate | Gate returns PASS, context flows through |
| **PIPE_010** | Gate stage halts pipeline when condition fails | gate | Pipeline status = 'failed', partial results preserved |
| **PIPE_011** | Gate with `skip-to` skips to named stage | gate | Skipped stages recorded, correct stage resumes |
| **PIPE_012** | Tap stage produces side effect without modifying context | tap | Next stage receives previous (pre-tap) context |
| **PIPE_013** | Transform stage reformats context without tools | transform | No tool calls made, context reformatted |
| **PIPE_014** | Fan-out splits context into 2 parallel paths | fan-out | Both sub-pipelines receive partitioned context |
| **PIPE_015** | Fan-in merges results from parallel paths | fan-out | Merged output contains data from both paths |
| **PIPE_016** | Branch routes to correct sub-pipeline | branch | Correct branch executes based on LLM condition evaluation |
| **PIPE_017** | Branch falls back to default when no match | branch | Default branch executes |
| **PIPE_018** | Loop repeats until condition met | loop | Loop runs 2+ iterations, exits on condition |
| **PIPE_019** | Loop respects max_iterations cap | loop | Loop exits at cap with appropriate status |
| **PIPE_020** | Recipe stage delegates to recipe engine | recipe | Recipe executes within stage scope |
| **PIPE_021** | Pipeline-level MITL approval card displays correctly | — | Card shows all stages, variables, estimates |
| **PIPE_022** | Pipeline-level MITL denial cancels entire pipeline | — | No stages execute, clean exit |
| **PIPE_023** | Stage-level MITL (`--confirm-stages`) pauses between stages | — | User can approve/skip/edit each stage |
| **PIPE_024** | MITL denial mid-pipeline preserves partial results | — | Completed stages' results available |
| **PIPE_025** | Context > 8K chars triggers auto-summarization | — | Summary preserves key facts |
| **PIPE_026** | Context > 32K chars writes to temp file | — | File reference passed, next stage can read |
| **PIPE_027** | Stage timeout triggers recovery strategy | — | Stage fails, recovery executes |
| **PIPE_028** | `onFailure: retry` retries with error context | — | Retry includes "previous attempt failed because…" |
| **PIPE_029** | `onFailure: skip` passes context through | — | Stage marked as skipped, context unchanged |
| **PIPE_030** | `onFailure: fallback` runs alternative intent | — | Fallback intent executes successfully |
| **PIPE_031** | Pipeline resumption from manifest | — | Resumed pipeline starts from correct stage |
| **PIPE_032** | Manifest records all execution metadata | — | All fields populated, times accurate |
| **PIPE_033** | `/pipe list` shows saved pipelines | — | Workspace + global pipelines listed |
| **PIPE_034** | `/pipe save` converts ad-hoc pipeline to YAML | — | Valid YAML file created |
| **PIPE_035** | `/pipe inspect` shows manifest details | — | All stages, timing, metrics displayed |
| **PIPE_036** | Security: max 20 stages enforced | — | Pipeline with 21 stages rejected at parse time |
| **PIPE_037** | Security: max total tool calls enforced | — | Pipeline halts when total cap reached |
| **PIPE_038** | Security: env scrubber runs on context transfer | — | Secrets in stage output are redacted |
| **PIPE_039** | Security: recursive pipeline invocation blocked | — | Pipeline stage cannot invoke another pipeline |
| **PIPE_040** | `when` conditional skips stage when false | — | Stage skipped, context passes through |

---

## 21. Migration & Compatibility

### 21.1 Backward Compatibility

NL Pipelines are a **purely additive feature**. No existing v2.0 behavior changes:

- Recipes continue to work identically
- The existing `AgentLoop` class is unchanged (pipelines create new instances per stage)
- The MITL interceptor gains new context types but existing types are unmodified
- No new environment variables are required (all pipeline config is optional)

### 21.2 Recipe → Pipeline Migration

Users can convert recipes to pipelines if they want dynamic behavior:

```bash
getit pipe --from-recipe setup-node-project
```

This reads the recipe's steps, converts each `intent` field to a pipeline stage, and offers to save the pipeline YAML. The reverse direction (pipeline → recipe) is also supported:

```bash
getit pipe --to-recipe todo-to-issues
```

### 21.3 Feature Detection

```typescript
// Check if pipeline engine is available (for plugins)
import { isPipelineAvailable } from '../pipelines/engine.js';

if (isPipelineAvailable()) {
  // Register pipeline-aware plugin features
}
```

---

## 22. Implementation Roadmap

### Phase 1: Core Engine (v2.1.0-alpha)
**Files:** `types.ts`, `parser.ts`, `engine.ts`, `context.ts`, `stages/standard.ts`  
**Tests:** PIPE_001–008, PIPE_021–024, PIPE_036–039  
**Deliverable:** Linear pipelines with standard stages, CLI parsing, pipeline-level MITL, context transfer, security constraints.

### Phase 2: Stage Types (v2.1.0-beta)
**Files:** `stages/gate.ts`, `stages/tap.ts`, `stages/transform.ts`, `stages/branch.ts`  
**Tests:** PIPE_009–013, PIPE_016–017, PIPE_040  
**Deliverable:** Gate, tap, transform, and branch stage types. Conditional execution (`when` clause).

### Phase 3: Advanced Flow (v2.1.0-rc1)
**Files:** `stages/fan-out.ts`, loop logic in engine, `recovery.ts`  
**Tests:** PIPE_014–015, PIPE_018–019, PIPE_027–030  
**Deliverable:** Fan-out/fan-in, loops, error recovery strategies, context size management.

### Phase 4: Persistence & Polish (v2.1.0)
**Files:** `manifest.ts`, `repl.ts`, TUI integration, recipe interop  
**Tests:** PIPE_020, PIPE_025–026, PIPE_031–035  
**Deliverable:** Execution manifests, REPL commands, TUI progress dashboard, recipe interop, pipeline resumption, ad-hoc-to-YAML save.

### Dependency Graph

```
Phase 1 ──▶ Phase 2 ──▶ Phase 3
   │                        │
   └────────────────────────┤
                            ▼
                        Phase 4
```

Phases 1 and 2 can overlap. Phase 3 depends on Phase 2 (branch/gate are used in fan-out). Phase 4 depends on all prior phases.

---

## Appendix A: Full Example — Security Audit Pipeline

```yaml
# .getit/pipelines/security-audit.yaml

name: security-audit
version: "1.0"
description: "Comprehensive security audit: dependency scan, code analysis, secret detection, and report generation."
author: "brian"

variables:
  severity_threshold:
    description: "Minimum severity to flag"
    default: "medium"
    enum: [low, medium, high, critical]
  create_issues:
    description: "Whether to create GitHub issues for findings"
    default: false
    type: boolean

stages:
  - id: dep-scan
    intent: "Scan package.json and package-lock.json for known vulnerabilities using npm audit. List each vulnerable package, its severity, and the recommended fix version."
    timeout: 60

  - id: secret-scan
    intent: "Scan all source files for hardcoded secrets, API keys, tokens, and credentials. Check .env files are in .gitignore. Report any findings with file path and line number."
    timeout: 90

  - id: code-analysis
    intent: "Analyze the codebase for common security anti-patterns: eval() usage, unsanitized user input, SQL injection vectors, path traversal risks, and insecure crypto usage."
    timeout: 120

  - id: combine
    type: transform
    intent: "Combine the dependency scan, secret scan, and code analysis results into a unified security report. Deduplicate findings. Sort by severity descending."

  - id: filter
    type: gate
    intent: "Are there any findings with severity {{severity_threshold}} or above?"
    on_fail: skip-to:report-clean

  - id: create-issues
    intent: "For each finding with severity {{severity_threshold}} or above, create a GitHub issue with reproduction steps and suggested fix."
    when: "{{create_issues}} is true"
    mitl: per-item
    timeout: 180

  - id: report
    intent: "Generate a markdown security audit report with executive summary, findings table, risk score, and recommended remediation timeline."

  - id: report-clean
    intent: "Generate a clean security audit report confirming no findings above the threshold."
```

---

## Appendix B: CLI Examples Gallery

```bash
# ─── Simple Pipelines ───────────────────────────────────────

# Code review
getit pipe "diff HEAD~3..HEAD" | "review for bugs, security, and style issues" | "write inline comments"

# Documentation generation
getit pipe "list all exported functions in src/" | "generate JSDoc for each" | "write to docs/api.md"

# Refactoring
getit pipe "find all uses of the old API" | "replace with the new API pattern" | "run tests to verify"

# ─── With Operators ─────────────────────────────────────────

# Gate: only proceed if there's work to do
getit pipe "check for uncommitted changes" |? "are there staged files?" | "commit with a descriptive message"

# Tap: log to file without modifying flow
getit pipe "run the test suite" |> "append results to test-history.log" | "fix any failures"

# Transform: reshape data between stages
getit pipe "fetch all open PRs" |! "extract just titles and authors" | "group by author and count"

# ─── Variables ──────────────────────────────────────────────

getit pipe "find files changed in the last {{days}} days" | "summarize the changes" --var days=7

# ─── Named Stages ──────────────────────────────────────────

getit pipe scan:"scan for TODO comments" | group:"categorize by urgency" | act:"create issues for criticals"

# ─── Saved Pipelines ───────────────────────────────────────

getit pipe --file .getit/pipelines/deploy-staging.yaml --var env=staging
getit pipe --dry-run --file .getit/pipelines/security-audit.yaml
getit pipe --resume run_2025_01_15_abc123 --from stage-3
```

---

*This specification is the source of truth for implementing Natural Language Pipelines in getit v2.1. All implementation decisions should reference this document. Update this spec when implementation reveals necessary changes.*
