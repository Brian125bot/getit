/**
 * @module transport
 * @description HTTP transport layer for all LLM carrier requests.
 *
 * Provides a single `chatCompletions()` function that handles both streaming
 * and non-streaming OpenAI-compatible chat completion requests across all
 * supported carriers (OpenRouter, OpenAI, Anthropic, Gemini, Groq, DeepSeek,
 * Mistral, Azure, Ollama, and more).
 *
 * All requests:
 *   - Are aborted after `options.timeoutMs` milliseconds.
 *   - Scrub the API key and any other high-entropy strings from error messages
 *     before they are propagated to the caller or logged.
 *   - Route through `validateApiAccess()` which throws a descriptive error
 *     before making any network call if a required API key is absent.
 *
 * For streaming responses, tokens are delivered to `options.onStreamToken` as
 * they arrive over SSE. Tool-call argument deltas are accumulated and returned
 * as a complete list once the stream closes.
 *
 * @see {@link https://github.com/Brian125bot/getit} for full documentation.
 */
import { CarrierPreset, requiresApiKey } from './registry.js';
import { scrubText } from '../security/scrubber.js';
import { getRuntimeSession } from '../runtime/session.js';

/**
 * A single message in a chat conversation history.
 *
 * Mirrors the OpenAI Chat Completions message schema so that the same
 * `ChatMessage[]` history can be forwarded unchanged to any OpenAI-compatible
 * carrier endpoint.
 */
export interface ChatMessage {
  /** The conversation participant role. */
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** Message content. May be null for assistant messages that contain only tool calls. */
  content: string | null;
  /** Optional name, used for `tool` role messages to identify the tool. */
  name?: string;
  /** For `tool` role messages: the ID of the tool call this is a response to. */
  tool_call_id?: string;
  /** For `assistant` role messages: list of tool calls requested by the model. */
  tool_calls?: any[];
}

/**
 * Normalised response from a chat completion request, abstracting over both
 * streaming and non-streaming response formats.
 */
export interface ChatCompletionResponse {
  /** Model-generated text content, or null if the response contains only tool calls. */
  content: string | null;
  /** List of tool calls requested by the model, if any. */
  tool_calls?: any[];
}

/**
 * Options passed to {@link chatCompletions}.
 */
export interface ChatCompletionOptions {
  /** Model identifier string (e.g. `"gpt-4o"`, `"anthropic/claude-3-5-sonnet"`). */
  model: string;
  /** Full conversation history to send to the API. */
  messages: ChatMessage[];
  /** Tool schemas to advertise to the model. Pass `[]` to disable tool use. */
  tools: any[];
  /** @deprecated Use `onStreamToken` presence to control streaming. */
  stream?: boolean;
  /**
   * If provided, the request is made in streaming mode and each text token
   * delta is passed to this callback as it arrives. Must handle empty strings.
   */
  onStreamToken?: (token: string) => void;
  /** Request timeout in milliseconds. Throws `AbortError` if exceeded. */
  timeoutMs: number;
}

/**
 * Builds the HTTP request headers for a carrier, injecting the API key in the
 * format expected by that carrier's authentication scheme.
 *
 * @param preset - The active carrier preset (from `registry.ts`).
 * @param apiKey - The resolved API key value, if available.
 * @returns A `Record<string, string>` suitable for use as `fetch` headers.
 */
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

/**
 * Validates that the required API key for a carrier is available.
 *
 * @throws {Error} with a user-friendly message naming the expected env-var(s)
 *   if the carrier requires an API key and none was provided.
 *
 * @param preset - The active carrier preset.
 * @param apiKey - The resolved API key value (may be undefined).
 */
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

/**
 * Sends a chat completion request to the active carrier.
 *
 * Handles both streaming (when `options.onStreamToken` is provided) and
 * non-streaming modes. In streaming mode, each content token delta is
 * delivered to `onStreamToken` as it arrives, and the full accumulated
 * response is returned when the stream closes. Tool call argument deltas
 * are accumulated internally and returned as a complete list.
 *
 * The request is automatically aborted after `options.timeoutMs` milliseconds.
 * Any API key present in error response bodies is scrubbed before the error
 * message is propagated.
 *
 * @param preset  - The active carrier preset (endpoint URL, auth scheme, etc.).
 * @param apiKey  - Resolved API key, or undefined for local carriers.
 * @param options - Request parameters (model, messages, tools, timeout, etc.).
 * @returns A promise resolving to the model's response with content and/or tool calls.
 * @throws {Error} on network failure, timeout, non-2xx HTTP status, or missing API key.
 */
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
    temperature: 0.1,
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
