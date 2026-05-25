/**
 * @module carriers/openrouter/catalog
 * @description OpenRouter model catalog for the auto-switcher.
 *
 * Fetches and caches the list of available models from the OpenRouter API,
 * including pricing, context length, and capability metadata.
 */

export interface ModelInfo {
  id: string;
  name: string;
  description: string;
  contextLength: number;
  pricing: {
    prompt: number;   // cost per token (prompt)
    completion: number; // cost per token (completion)
  };
  capabilities: ModelCapability[];
  provider: string;
  maxOutput: number;
  isFree: boolean;
}

export type ModelCapability = 'chat' | 'code' | 'reasoning' | 'vision' | 'function_calling' | 'json_mode';

interface CatalogCache {
  models: ModelInfo[];
  fetchedAt: number;
  ttlMs: number;
}

const OPENROUTER_API = 'https://openrouter.ai/api/v1/models';
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

let cache: CatalogCache | null = null;

/**
 * Fetch the model catalog from OpenRouter.
 */
export async function fetchCatalog(apiKey?: string): Promise<ModelInfo[]> {
  // Return cached if still fresh
  if (cache && Date.now() - cache.fetchedAt < cache.ttlMs) {
    return cache.models;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(OPENROUTER_API, { headers });
  if (!response.ok) {
    throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { data: any[] };
  const models: ModelInfo[] = data.data.map(parseModelEntry);

  cache = {
    models,
    fetchedAt: Date.now(),
    ttlMs: CACHE_TTL
  };

  return models;
}

/**
 * Get a single model by ID.
 */
export async function getModel(modelId: string, apiKey?: string): Promise<ModelInfo | undefined> {
  const models = await fetchCatalog(apiKey);
  return models.find(m => m.id === modelId);
}

/**
 * Search models by name or capability.
 */
export async function searchModels(
  query: string,
  filters: { capability?: ModelCapability; maxPrice?: number; minContext?: number } = {},
  apiKey?: string
): Promise<ModelInfo[]> {
  let models = await fetchCatalog(apiKey);

  // Text search
  if (query) {
    const lower = query.toLowerCase();
    models = models.filter(m =>
      m.id.toLowerCase().includes(lower) ||
      m.name.toLowerCase().includes(lower) ||
      m.provider.toLowerCase().includes(lower)
    );
  }

  // Capability filter
  if (filters.capability) {
    models = models.filter(m => m.capabilities.includes(filters.capability!));
  }

  // Price filter
  if (filters.maxPrice !== undefined) {
    models = models.filter(m => m.pricing.prompt <= filters.maxPrice!);
  }

  // Context length filter
  if (filters.minContext !== undefined) {
    models = models.filter(m => m.contextLength >= filters.minContext!);
  }

  return models;
}

/**
 * Invalidate the model cache.
 */
export function invalidateCache(): void {
  cache = null;
}

/**
 * Parse a raw model entry from the OpenRouter API.
 */
function parseModelEntry(raw: any): ModelInfo {
  const pricing = raw.pricing || {};

  // Detect capabilities from model metadata
  const capabilities: ModelCapability[] = ['chat'];
  const nameLower = (raw.name || raw.id || '').toLowerCase();
  if (nameLower.includes('code') || nameLower.includes('codestral') || nameLower.includes('deepseek-coder')) {
    capabilities.push('code');
  }
  if (nameLower.includes('vision') || raw.architecture?.modality === 'multimodal') {
    capabilities.push('vision');
  }
  if (nameLower.includes('o1') || nameLower.includes('o3') || nameLower.includes('reasoning')) {
    capabilities.push('reasoning');
  }

  return {
    id: raw.id || '',
    name: raw.name || raw.id || 'Unknown',
    description: raw.description || '',
    contextLength: raw.context_length || 4096,
    pricing: {
      prompt: parseFloat(pricing.prompt || '0'),
      completion: parseFloat(pricing.completion || '0')
    },
    capabilities,
    provider: (raw.id || '').split('/')[0] || 'unknown',
    maxOutput: raw.top_provider?.max_completion_tokens || raw.context_length || 4096,
    isFree: parseFloat(pricing.prompt || '0') === 0 && parseFloat(pricing.completion || '0') === 0
  };
}
