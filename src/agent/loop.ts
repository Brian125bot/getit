/**
 * @module loop
 * @description Core multi-turn agent execution loop for getit.
 *
 * `AgentLoop` drives the conversation between the user, the LLM, and the MITL
 * (Man-in-the-Loop) approval gate. Each call to `runTurn()` appends the user
 * message to the conversation history, sends the history to the active carrier,
 * and then iterates over any tool calls the model requests — each of which is
 * intercepted by `src/mitl/interceptor.ts` for human approval before execution.
 *
 * ### Safety mechanisms built into this loop
 * - **Runaway execution guard:** A maximum of 10 tool-call iterations per turn
 *   prevents infinite agent loops from consuming tokens or causing system damage.
 * - **Halt propagation:** Any tool execution that returns a `halt` signal
 *   immediately stops the iteration and returns control to the user.
 * - **History pruning:** Conversation history is automatically capped at 25
 *   messages (plus the system prompt) to prevent context-window overflow on
 *   long sessions. System prompt is always preserved.
 * - **Streaming scrubber:** All tokens streamed to stdout pass through
 *   `StreamScrubber` before they are written to the terminal, ensuring no
 *   high-entropy secrets leak in model-generated markdown.
 *
 * ### v2.0 additions
 * - **Dynamic tool schemas:** Uses `getToolSchemas()` to merge built-in + plugin tools.
 * - **Session memory injection:** Appends session/project/preference context to turns.
 * - **Recipe recording:** When recording is active, dispatched tool calls are captured.
 *
 * @see {@link https://github.com/Brian125bot/getit} for full documentation.
 */
import { sendChatRequest, ChatMessage } from './client.js';
import { getToolSchemas } from './tools.js';
import { dispatchToolCall } from '../tools/registry.js';
import { renderGuardrailViolationCard } from '../mitl/interceptor.js';
import { undoLedger } from '../backup/ledger.js';
import { getRuntimeSession, startPromptTransaction } from '../runtime/session.js';
import { scrubText, StreamScrubber } from '../security/scrubber.js';
import { loadConfig } from '../security/secrets-loader.js';
import { resolveActivePreset } from '../carriers/registry.js';
import { TerminalSpinner } from '../ui/spinner.js';
import { buildSessionContext, recordToolCall } from '../memory/sessions.js';
import { buildProjectContext } from '../memory/projects.js';
import { buildPreferencesContext } from '../memory/preferences.js';
import { isRecording, recordStep } from '../recipes/recorder.js';

/**
 * Orchestrates multi-turn LLM conversations with MITL tool-call interception.
 *
 * One `AgentLoop` instance is created per REPL session and shared across all
 * user turns so that conversation history accumulates naturally. Call
 * `resetSession()` to clear history while preserving the system prompt.
 *
 * @example
 * const loop = new AgentLoop(systemPromptText);
 * await loop.runTurn('install ripgrep');
 */
export class AgentLoop {
  private messages: ChatMessage[] = [];

  constructor(systemPrompt: string) {
    this.messages.push({
      role: 'system',
      content: systemPrompt
    });
  }

  public getMessages(): ChatMessage[] {
    return this.messages;
  }

  public resetSession(systemPrompt: string): void {
    this.messages = [{
      role: 'system',
      content: systemPrompt
    }];
  }

  public addDirectMessage(role: 'user' | 'assistant' | 'system', content: string) {
    this.messages.push({ role, content });
  }

  private pruneHistory(): void {
    // Keep max 25 messages in history to prevent OOM and context window exhaustion
    if (this.messages.length <= 25) return;

    const systemPrompt = this.messages[0];
    let sliceStart = this.messages.length - 20;

    // Ensure we do not decouple tool results from their tool calls
    while (
      sliceStart > 1 &&
      (this.messages[sliceStart].role === 'tool' ||
        (this.messages[sliceStart - 1] &&
          this.messages[sliceStart - 1].role === 'assistant' &&
          this.messages[sliceStart - 1].tool_calls))
    ) {
      sliceStart--;
    }

    const pruned = this.messages.slice(sliceStart);
    this.messages = [systemPrompt, ...pruned];
  }

  /**
   * Build memory context to inject into the system prompt or as a hidden user message.
   * v2.0: combines session memory, project memory, and user preferences.
   */
  private buildMemoryContext(): string {
    const parts: string[] = [];

    try {
      const sessionCtx = buildSessionContext();
      if (sessionCtx) parts.push(sessionCtx);
    } catch { /* memory may not be initialized */ }

    try {
      const projectCtx = buildProjectContext();
      if (projectCtx) parts.push(projectCtx);
    } catch { /* project detection may fail */ }

    try {
      const prefCtx = buildPreferencesContext();
      if (prefCtx) parts.push(prefCtx);
    } catch { /* prefs may not exist */ }

    return parts.join('\n\n');
  }

  public async runTurn(userInput: string): Promise<void> {
    startPromptTransaction();

    // Prune history before turn begins to fit in context window
    this.pruneHistory();

    this.messages.push({
      role: 'user',
      content: userInput
    });

    // v2.0: Inject memory context as a system message before the turn
    const memoryCtx = this.buildMemoryContext();
    if (memoryCtx) {
      this.messages.push({
        role: 'system',
        content: `[Memory Context]\n${memoryCtx}`
      });
    }

    let continueLoop = true;
    let iterationCount = 0;

    while (continueLoop) {
      iterationCount++;
      // v2.0: Architectural Guardrail Interception
      const session = getRuntimeSession();
      const blockingViolations = session.guardrailViolations.filter(v => v.severity === 'block');
      const warningViolations = session.guardrailViolations.filter(v => v.severity === 'warn');

      // Print non-blocking warnings
      if (warningViolations.length > 0) {
        for (const warn of warningViolations) {
          console.log(`\n\x1b[1;33m[GUARDRAIL WARNING] ${warn.ruleId}: ${warn.description}\x1b[0m`);
          console.log(`\x1b[33m  File: ${warn.filePath} (line ${warn.line})\x1b[0m`);
        }
      }

      if (blockingViolations.length > 0) {
        const mitlResult = await renderGuardrailViolationCard(session.guardrailViolations);

        if (mitlResult.action === 'heal') {
          const healPrompt = `[GUARDRAIL VIOLATION]: The following structural violations were detected and must be repaired immediately:\n\n` +
            session.guardrailViolations.map(v => `- [${v.severity.toUpperCase()}] ${v.ruleId}: ${v.description}\n  File: ${v.filePath} (Line ${v.line})\n  Remediation: ${v.remediationHint}`).join('\n');

          this.messages.push({ role: 'user', content: healPrompt });
          session.guardrailViolations = []; // Clear for next turn
          continue; // Re-invoke chat completion for healing
        } else if (mitlResult.action === 'abort') {
          console.log('\n\x1b[1;31m[getit] Aborting turn and rolling back changes...\x1b[0m');
          await undoLedger();
          session.guardrailViolations = [];
          return;
        } else if (mitlResult.action === 'ignore') {
          console.log('\n\x1b[1;33m[getit] Violation ignored by user. Proceeding...\x1b[0m');
          // Ephemeral ignore - clear violations but don't persist
          session.guardrailViolations = [];
        }
      }
      if (iterationCount > 10) {
        console.log('\n\x1b[1;31m[getit] Safety Halt: Runaway execution prevention triggered (max 10 tool iterations per turn).\x1b[0m');
        break;
      }

      const config = loadConfig();
      const preset = resolveActivePreset(config.carrier, config.baseUrl);
      const spinner = new TerminalSpinner(`Contacting ${preset.displayName}...`);
      spinner.start();

      // v2.0: Use dynamic tool schemas (built-in + plugins)
      const schemas = getToolSchemas();
      
      let firstToken = true;
      try {
        const session = getRuntimeSession();
        const scrubber = new StreamScrubber(session.maskingSession);
        
        const response = await sendChatRequest(
          this.messages,
          schemas,
          (token) => {
            if (firstToken) {
              spinner.succeed();
              process.stdout.write('\x1b[32mgetit-assistant ❯ \x1b[0m');
              firstToken = false;
            }
            const safeChunk = scrubber.push(token);
            if (safeChunk) {
              process.stdout.write(safeChunk);
            }
          }
        );
        
        const finalChunk = scrubber.flush();
        if (finalChunk) {
          process.stdout.write(finalChunk);
        }
        
        if (firstToken) {
          spinner.succeed();
          process.stdout.write('\x1b[32mgetit-assistant ❯ \x1b[0m');
        }
        console.log(); // end of assistant stream line

        // 1. If we got tool calls, execute them recursively
        if (response.tool_calls && response.tool_calls.length > 0) {
          // Add the assistant's request to the messages history
          this.messages.push({
            role: 'assistant',
            content: response.content,
            tool_calls: response.tool_calls
          });

          let haltLoop = false;

          for (const toolCall of response.tool_calls) {
            const name = toolCall.function.name;
            const argsString = toolCall.function.arguments;
            let args: any = {};

            try {
              args = JSON.parse(argsString);
            } catch {
              console.error(`\x1b[31m[getit] Failed to parse tool arguments: ${argsString}\x1b[0m`);
            }

            console.log(`\n\x1b[35m[getit] Dispatching Tool Call: ${name}\x1b[0m`);

            // v2.0: Record step if recipe recording is active
            if (isRecording()) {
              recordStep(name, args, `Agent called ${name}`);
            }
            
            const dispatchResult = await dispatchToolCall(name, args);

            // v2.0: Record to session memory (best-effort; never halts the loop)
            try {
              await recordToolCall(name, !dispatchResult.haltTurn);
            } catch { /* session memory write is best-effort */ }

            // Append the tool execution result back to the history
            this.messages.push({
              role: 'tool',
              name: name,
              tool_call_id: toolCall.id,
              content: dispatchResult.content
            });

            if (dispatchResult.clarifyRequest) {
              this.messages.push({
                role: 'user',
                content: dispatchResult.clarifyRequest
              });
            } else if (dispatchResult.haltTurn) {
              haltLoop = true;
              console.log(`\x1b[1;31m[getit] Fail-Closed: Execution generated a halt signal. Halting automatic agent iterations.\x1b[0m`);
            }
          }

          if (haltLoop) {
            continueLoop = false;
          }
        } else {
          // No tool calls, assistant gave a final text response. Add to history and exit.
          this.messages.push({
            role: 'assistant',
            content: response.content
          });
          continueLoop = false;
        }

      } catch (err: any) {
        if (firstToken) {
          spinner.fail(`Failed to contact ${preset.displayName}`);
        }
        console.error(`\n\x1b[31m[getit] API or System Error: ${err.message}\x1b[0m`);
        continueLoop = false;
      }
    }
  }
}
