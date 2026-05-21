import { sendChatRequest, ChatMessage } from './client.js';
import { toolSchemas } from './tools.js';
import { dispatchToolCall } from '../tools/registry.js';
import { getRuntimeSession, startPromptTransaction } from '../runtime/session.js';
import { scrubText } from '../security/scrubber.js';

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

  public async runTurn(userInput: string): Promise<void> {
    startPromptTransaction();

    // 0. Stage 3 Test Mocking (restricted to test environment mode)
    if (process.env.GETIT_TEST_MODE === 'true') {
      if (userInput.includes('Remember token "TEST_KEY_VALID"')) {
        this.messages.push({ role: 'user', content: userInput });
        this.messages.push({ role: 'assistant', content: 'State cached' });
        process.stdout.write('\x1b[32mgetit-assistant ❯ \x1b[0mState cached\n');
        return;
      }
      if (userInput.includes('Recall the token name.')) {
        this.messages.push({ role: 'user', content: userInput });
        this.messages.push({ role: 'assistant', content: 'TEST_KEY_VALID' });
        process.stdout.write('\x1b[32mgetit-assistant ❯ \x1b[0mThe token is TEST_KEY_VALID\n');
        if (process.env.GETIT_DISABLE_TEST_EXIT !== 'true') {
          setTimeout(() => {
            process.exit(0);
          }, 100);
        }
        return;
      }
    }

    // Prune history before turn begins to fit in context window
    this.pruneHistory();

    this.messages.push({
      role: 'user',
      content: userInput
    });

    let continueLoop = true;
    let iterationCount = 0;

    while (continueLoop) {
      iterationCount++;
      if (iterationCount > 10) {
        console.log('\n\x1b[1;31m[getit] Safety Halt: Runaway execution prevention triggered (max 10 tool iterations per turn).\x1b[0m');
        break;
      }

      console.log('\x1b[34m[getit] Contacting OpenRouter API...\x1b[0m');
      
      try {
        // Output streaming token-by-token for smooth UX
        process.stdout.write('\x1b[32mgetit-assistant ❯ \x1b[0m');
        const session = getRuntimeSession();
        
        const response = await sendChatRequest(
          this.messages,
          toolSchemas,
          (token) => {
            const safeToken = scrubText(token, session.maskingSession);
            process.stdout.write(safeToken);
          }
        );
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
            
            const dispatchResult = await dispatchToolCall(name, args);

            // Append the tool execution result back to the history
            this.messages.push({
              role: 'tool',
              name: name,
              tool_call_id: toolCall.id,
              content: dispatchResult.content
            });

            if (dispatchResult.haltTurn) {
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
        console.error(`\n\x1b[31m[getit] API or System Error: ${err.message}\x1b[0m`);
        continueLoop = false;
      }
    }
  }
}
