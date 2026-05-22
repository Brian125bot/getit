import { CarrierPreset, requiresApiKey } from './registry.js';
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

export interface ChatCompletionOptions {
  model: string;
  messages: ChatMessage[];
  tools: any[];
  stream?: boolean;
  onStreamToken?: (token: string) => void;
  timeoutMs: number;
}

export function buildRequestHeaders(preset: CarrierPreset, apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (preset.headerExtras) {
    for (const [k, v] of Object.entries(preset.headerExtras)) {
      if (k === 'api-key' && apiKey) {
        headers['api-key'] = apiKey;
      } else if (v) {
        headers[k] = v;
      }
    }
  }

  if (preset.auth === 'bearer' && apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else if (preset.auth === 'api-key-header' && apiKey) {
    headers['api-key'] = apiKey;
  }

  return headers;
}

export function validateApiAccess(preset: CarrierPreset, apiKey?: string): void {
  if (requiresApiKey(preset) && !apiKey) {
    const envHint = preset.keyEnvVars.slice(0, 2).join(' or ');
    throw new Error(
      `API key is not set for ${preset.displayName}. Set ${envHint} in your environment or .getitrc file.`
    );
  }
}

function scrubErrorText(text: string, apiKey?: string): string {
  let cleaned = text;
  if (apiKey) {
    cleaned = cleaned.replace(new RegExp(apiKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'sk-***');
  }
  return scrubText(cleaned, getRuntimeSession().maskingSession);
}

function resolveChatUrl(baseUrl: string, presetId: string): string {
  if (presetId === 'azure' && !baseUrl.includes('/chat/completions')) {
    const sep = baseUrl.includes('?') ? '&' : '?';
    const version = baseUrl.includes('api-version=') ? '' : `${sep}api-version=2024-02-15-preview`;
    return `${baseUrl}/chat/completions${version}`;
  }
  return `${baseUrl}/chat/completions`;
}

export async function chatCompletions(
  preset: CarrierPreset,
  apiKey: string | undefined,
  options: ChatCompletionOptions
): Promise<ChatCompletionResponse> {
  validateApiAccess(preset, apiKey);

  const payload = {
    model: options.model,
    messages: options.messages,
    tools: options.tools.length > 0 ? options.tools : undefined,
    tool_choice: options.tools.length > 0 ? 'auto' : undefined,
    max_tokens: 4096,
    stream: !!options.onStreamToken,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);

  const requestUrl = resolveChatUrl(preset.baseUrl, preset.id);
  const headers = buildRequestHeaders(preset, apiKey);

  let response: Response;
  try {
    response = await fetch(requestUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err.name === 'AbortError') {
      throw new Error(`API request timed out after ${options.timeoutMs}ms.`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errText = await response.text();
    const cleanErrText = scrubErrorText(errText, apiKey);
    throw new Error(`API Request failed with status ${response.status}: ${cleanErrText}`);
  }

  if (options.onStreamToken && response.body) {
    return parseStreamingResponse(response.body, options.onStreamToken);
  }

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

async function parseStreamingResponse(
  body: ReadableStream<Uint8Array>,
  onStreamToken: (token: string) => void
): Promise<ChatCompletionResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let contentResult = '';
  const accumulatedToolCalls: Record<number, any> = {};

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const jsonStr = trimmed.slice(5).trim();

      if (jsonStr === '[DONE]') break;

      try {
        const chunk = JSON.parse(jsonStr);
        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const token = choice.delta?.content;
        if (token) {
          contentResult += token;
          onStreamToken(token);
        }

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
            if (delta.id) accumulatedToolCalls[index].id = delta.id;
            if (delta.function?.name) {
              accumulatedToolCalls[index].function.name += delta.function.name;
            }
            if (delta.function?.arguments) {
              accumulatedToolCalls[index].function.arguments += delta.function.arguments;
            }
          }
        }
      } catch {
        // Ignore malformed SSE chunks
      }
    }
  }

  const toolCallsList = Object.values(accumulatedToolCalls);
  return {
    content: contentResult || null,
    tool_calls: toolCallsList.length > 0 ? toolCallsList : undefined,
  };
}

/** Lightweight connectivity check for wizard / doctor. */
export async function pingCarrier(
  preset: CarrierPreset,
  apiKey: string | undefined,
  timeoutMs = 10000
): Promise<{ ok: boolean; message: string }> {
  if (requiresApiKey(preset) && !apiKey) {
    return { ok: false, message: 'API key required but not configured.' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const modelsUrl = `${preset.baseUrl}/models`;
    const headers = buildRequestHeaders(preset, apiKey);
    const response = await fetch(modelsUrl, { method: 'GET', headers, signal: controller.signal });

    if (response.ok) {
      return { ok: true, message: `Connected to ${preset.displayName} (${response.status}).` };
    }

    // Some local servers lack /models; try minimal completion
    if (response.status === 404 && preset.id === 'ollama') {
      return pingViaCompletion(preset, apiKey, timeoutMs);
    }

    const text = await response.text();
    return { ok: false, message: `HTTP ${response.status}: ${scrubErrorText(text, apiKey).slice(0, 120)}` };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return { ok: false, message: `Connection timed out after ${timeoutMs}ms.` };
    }
    return { ok: false, message: err.message || 'Connection failed.' };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function pingViaCompletion(
  preset: CarrierPreset,
  apiKey: string | undefined,
  timeoutMs: number
): Promise<{ ok: boolean; message: string }> {
  try {
    await chatCompletions(preset, apiKey, {
      model: preset.defaultModel,
      messages: [{ role: 'user', content: 'ping' }],
      tools: [],
      timeoutMs,
    });
    return { ok: true, message: `Connected to ${preset.displayName} via chat completions.` };
  } catch (err: any) {
    return { ok: false, message: err.message?.slice(0, 120) || 'Completion ping failed.' };
  }
}
