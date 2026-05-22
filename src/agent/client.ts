import { loadConfig } from '../security/secrets-loader.js';
import { scrubText } from '../security/scrubber.js';
import { getRuntimeSession } from '../runtime/session.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: any[];
}

export interface ChatCompletionResponse {
  content: string | null;
  tool_calls?: any[];
}

let activeModel = 'nvidia/nemotron-3-super-120b-a12b:free';

export function getActiveModel(): string {
  return activeModel;
}

export function setActiveModel(model: string): void {
  activeModel = model;
}

export async function sendChatRequest(
  messages: ChatMessage[],
  tools: any[],
  onStreamToken?: (token: string) => void
): Promise<ChatCompletionResponse> {
  const config = loadConfig();
  const apiKey = config.apiKey;
  if (!apiKey) {
    throw new Error('API key is not set. Please set it in your environment or in a .env/.getitrc file.');
  }

  // Use config-defined model if the active model remains the initial historical default
  const currentModel = activeModel === 'nvidia/nemotron-3-super-120b-a12b:free' ? config.model : activeModel;

  const payload = {
    model: currentModel,
    messages,
    tools: tools.length > 0 ? tools : undefined,
    tool_choice: tools.length > 0 ? 'auto' : undefined,
    max_tokens: 4096,
    stream: onStreamToken ? true : false,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s request timeout

  const requestUrl = `${config.baseUrl}/chat/completions`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  if (config.carrier === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/getit-workspace-agent';
    headers['X-Title'] = 'GetIt Workspace Agent';
  }

  let response: Response;
  try {
    response = await fetch(requestUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error('API request timed out after 60 seconds.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errText = await response.text();
    // Sanitize the errText to ensure API keys are not echoed in logs
    const cleanErrText = scrubText(errText.replace(new RegExp(apiKey, 'g'), 'sk-***'), getRuntimeSession().maskingSession);
    throw new Error(`API Request failed with status ${response.status}: ${cleanErrText}`);
  }

  if (onStreamToken && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let contentResult = '';
    const accumulatedToolCalls: Record<number, any> = {};

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // keep the last partial line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const jsonStr = trimmed.slice(5).trim(); // Remove "data:" prefix
        
        if (jsonStr === '[DONE]') {
          break;
        }

        try {
          const chunk = JSON.parse(jsonStr);
          const choice = chunk.choices?.[0];
          if (!choice) continue;

          // 1. Text token streaming
          const token = choice.delta?.content;
          if (token) {
            contentResult += token;
            onStreamToken(token);
          }

          // 2. Tool calls delta streaming
          const deltas = choice.delta?.tool_calls;
          if (deltas) {
            for (const delta of deltas) {
              const index = delta.index;
              if (accumulatedToolCalls[index] === undefined) {
                accumulatedToolCalls[index] = {
                  id: delta.id,
                  type: 'function',
                  function: { name: '', arguments: '' },
                };
              }
              if (delta.id) {
                accumulatedToolCalls[index].id = delta.id;
              }
              if (delta.function?.name) {
                accumulatedToolCalls[index].function.name += delta.function.name;
              }
              if (delta.function?.arguments) {
                accumulatedToolCalls[index].function.arguments += delta.function.arguments;
              }
            }
          }
        } catch {
          // Ignore parsing issues from malformed chunks
        }
      }
    }

    const toolCallsList = Object.values(accumulatedToolCalls);
    return {
      content: contentResult || null,
      tool_calls: toolCallsList.length > 0 ? toolCallsList : undefined,
    };
  } else {
    // Non-streaming fallback
    const data: any = await response.json();
    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error('API returned an empty choices array.');
    }
    return {
      content: choice.message?.content || null,
      tool_calls: choice.message?.tool_calls || undefined,
    };
  }
}
