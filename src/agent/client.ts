import { loadConfig } from '../security/secrets-loader.js';
import { resolveActivePreset } from '../carriers/registry.js';
import {
  chatCompletions,
  ChatMessage,
  ChatCompletionResponse,
} from '../carriers/transport.js';

export type { ChatMessage, ChatCompletionResponse };

let activeModel: string | null = null;
let sessionDefaultModel: string | null = null;

export function getActiveModel(): string {
  if (activeModel) return activeModel;
  return loadConfig().model;
}

export function setActiveModel(model: string): void {
  activeModel = model;
}

export function initSessionModel(model: string): void {
  sessionDefaultModel = model;
  activeModel = model;
}

let chatRequestMock: ((messages: ChatMessage[], tools: any[]) => Promise<ChatCompletionResponse>) | null = null;

export function setChatRequestMock(mock: typeof chatRequestMock): void {
  chatRequestMock = mock;
}

export async function sendChatRequest(
  messages: ChatMessage[],
  tools: any[],
  onStreamToken?: (token: string) => void
): Promise<ChatCompletionResponse> {
  if (chatRequestMock) {
    return chatRequestMock(messages, tools);
  }

  const config = loadConfig();
  const preset = resolveActivePreset(config.carrier, config.baseUrl);

  const currentModel = activeModel || config.model;

  return chatCompletions(preset, config.apiKey, {
    model: currentModel,
    messages,
    tools,
    onStreamToken,
    timeoutMs: config.timeout,
  });
}
