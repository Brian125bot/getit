export type CarrierId =
  | 'openrouter'
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'groq'
  | 'deepseek'
  | 'together'
  | 'mistral'
  | 'azure'
  | 'ollama'
  | 'custom';

export type CarrierAuth = 'bearer' | 'none' | 'api-key-header';

export interface CarrierPreset {
  id: CarrierId;
  displayName: string;
  baseUrl: string;
  defaultModel: string;
  auth: CarrierAuth;
  headerExtras?: Record<string, string>;
  keyEnvVars: string[];
  docsUrl: string;
  supportsTools: boolean;
  openAiCompatible: boolean;
}

const CARRIER_PRESETS: Record<CarrierId, CarrierPreset> = {
  openrouter: {
    id: 'openrouter',
    displayName: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'nvidia/nemotron-3-super-120b-a12b:free',
    auth: 'bearer',
    headerExtras: {
      'HTTP-Referer': 'https://github.com/getit-workspace-agent',
      'X-Title': 'GetIt Workspace Agent',
    },
    keyEnvVars: ['OPENROUTER_API_KEY', 'GETIT_API_KEY', 'API_KEY'],
    docsUrl: 'https://openrouter.ai/keys',
    supportsTools: true,
    openAiCompatible: true,
  },
  openai: {
    id: 'openai',
    displayName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    auth: 'bearer',
    keyEnvVars: ['OPENAI_API_KEY', 'GETIT_API_KEY', 'API_KEY'],
    docsUrl: 'https://platform.openai.com/api-keys',
    supportsTools: true,
    openAiCompatible: true,
  },
  anthropic: {
    id: 'anthropic',
    displayName: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-sonnet-20241022',
    auth: 'bearer',
    keyEnvVars: ['ANTHROPIC_API_KEY', 'GETIT_API_KEY', 'API_KEY'],
    docsUrl: 'https://console.anthropic.com/settings/keys',
    supportsTools: true,
    openAiCompatible: true,
  },
  google: {
    id: 'google',
    displayName: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.0-flash',
    auth: 'bearer',
    keyEnvVars: ['GOOGLE_API_KEY', 'GEMINI_API_KEY', 'GETIT_API_KEY', 'API_KEY'],
    docsUrl: 'https://aistudio.google.com/apikey',
    supportsTools: true,
    openAiCompatible: true,
  },
  groq: {
    id: 'groq',
    displayName: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    auth: 'bearer',
    keyEnvVars: ['GROQ_API_KEY', 'GETIT_API_KEY', 'API_KEY'],
    docsUrl: 'https://console.groq.com/keys',
    supportsTools: true,
    openAiCompatible: true,
  },
  deepseek: {
    id: 'deepseek',
    displayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    auth: 'bearer',
    keyEnvVars: ['DEEPSEEK_API_KEY', 'GETIT_API_KEY', 'API_KEY'],
    docsUrl: 'https://platform.deepseek.com/api_keys',
    supportsTools: true,
    openAiCompatible: true,
  },
  together: {
    id: 'together',
    displayName: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    auth: 'bearer',
    keyEnvVars: ['TOGETHER_API_KEY', 'GETIT_API_KEY', 'API_KEY'],
    docsUrl: 'https://api.together.xyz/settings/api-keys',
    supportsTools: true,
    openAiCompatible: true,
  },
  mistral: {
    id: 'mistral',
    displayName: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    auth: 'bearer',
    keyEnvVars: ['MISTRAL_API_KEY', 'GETIT_API_KEY', 'API_KEY'],
    docsUrl: 'https://console.mistral.ai/api-keys',
    supportsTools: true,
    openAiCompatible: true,
  },
  azure: {
    id: 'azure',
    displayName: 'Azure OpenAI',
    baseUrl: 'https://YOUR_RESOURCE.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT',
    defaultModel: 'gpt-4o',
    auth: 'api-key-header',
    headerExtras: { 'api-key': '' },
    keyEnvVars: ['AZURE_OPENAI_API_KEY', 'OPENAI_API_KEY', 'GETIT_API_KEY', 'API_KEY'],
    docsUrl: 'https://portal.azure.com',
    supportsTools: true,
    openAiCompatible: true,
  },
  ollama: {
    id: 'ollama',
    displayName: 'Ollama (Local)',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3',
    auth: 'none',
    keyEnvVars: ['GETIT_API_KEY', 'API_KEY'],
    docsUrl: 'https://ollama.com',
    supportsTools: true,
    openAiCompatible: true,
  },
  custom: {
    id: 'custom',
    displayName: 'Custom Endpoint',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3',
    auth: 'bearer',
    keyEnvVars: ['GETIT_API_KEY', 'API_KEY'],
    docsUrl: '',
    supportsTools: true,
    openAiCompatible: true,
  },
};

/** Legacy carrier string aliases from older configs. */
const CARRIER_ALIASES: Record<string, CarrierId> = {
  local: 'ollama',
};

const ALL_CARRIER_IDS: CarrierId[] = [
  'openrouter',
  'openai',
  'anthropic',
  'google',
  'groq',
  'deepseek',
  'together',
  'mistral',
  'azure',
  'ollama',
  'custom',
];

export function listCarrierPresets(): CarrierPreset[] {
  return ALL_CARRIER_IDS.map((id) => CARRIER_PRESETS[id]);
}

export function getPreset(id: CarrierId): CarrierPreset {
  return { ...CARRIER_PRESETS[id] };
}

export function normalizeCarrierId(raw?: string): CarrierId {
  if (!raw) return 'openrouter';
  const norm = raw.trim().toLowerCase();
  if (norm in CARRIER_ALIASES) {
    return CARRIER_ALIASES[norm];
  }
  if ((ALL_CARRIER_IDS as string[]).includes(norm)) {
    return norm as CarrierId;
  }
  return 'custom';
}

/**
 * Infer ollama when legacy "custom" points at a local OpenAI-compatible server.
 */
export function inferCarrierId(carrierId: CarrierId, baseUrl?: string): CarrierId {
  if (carrierId !== 'custom' || !baseUrl) return carrierId;
  try {
    const host = new URL(baseUrl).hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return 'ollama';
    }
  } catch {
    // keep custom
  }
  return carrierId;
}

export function requiresApiKey(preset: CarrierPreset): boolean {
  return preset.auth !== 'none';
}

export function resolveActivePreset(
  carrierId: CarrierId,
  baseUrl?: string
): CarrierPreset {
  const normalized = inferCarrierId(carrierId, baseUrl);
  const preset = getPreset(normalized);
  if (baseUrl) {
    let url = baseUrl.trim();
    if (url.endsWith('/')) url = url.slice(0, -1);
    return { ...preset, baseUrl: url };
  }
  return preset;
}

export function buildAzureBaseUrl(resource: string, deployment: string, apiVersion = '2024-02-15-preview'): string {
  const base = `https://${resource}.openai.azure.com/openai/deployments/${deployment}`;
  return base;
}

export function getAzureApiVersion(baseUrl: string): string {
  if (baseUrl.includes('api-version=')) return '';
  return '2024-02-15-preview';
}
