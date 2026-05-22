import { CarrierPreset, requiresApiKey } from './registry.js';
import { buildRequestHeaders } from './transport.js';

const modelCache = new Map<string, { models: string[]; fetchedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheKey(preset: CarrierPreset, baseUrl: string): string {
  return `${preset.id}:${baseUrl}`;
}

export function clearModelCache(): void {
  modelCache.clear();
}

export async function listModels(
  preset: CarrierPreset,
  apiKey?: string,
  options: { forceRefresh?: boolean; timeoutMs?: number } = {}
): Promise<string[]> {
  const key = cacheKey(preset, preset.baseUrl);
  const cached = modelCache.get(key);
  const now = Date.now();

  if (!options.forceRefresh && cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.models;
  }

  if (requiresApiKey(preset) && !apiKey) {
    return [preset.defaultModel];
  }

  const timeoutMs = options.timeoutMs ?? 10000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${preset.baseUrl}/models`;
    const headers = buildRequestHeaders(preset, apiKey);
    const response = await fetch(url, { method: 'GET', headers, signal: controller.signal });

    if (!response.ok) {
      return [preset.defaultModel];
    }

    const data: any = await response.json();
    const ids: string[] = (data.data || data.models || [])
      .map((m: any) => m.id || m.name)
      .filter((id: unknown): id is string => typeof id === 'string')
      .sort();

    const models = ids.length > 0 ? ids : [preset.defaultModel];
    modelCache.set(key, { models, fetchedAt: now });
    return models;
  } catch {
    return [preset.defaultModel];
  } finally {
    clearTimeout(timeoutId);
  }
}

export function formatModelList(models: string[], max = 20): string {
  const shown = models.slice(0, max);
  const lines = shown.map((m, i) => `  ${String(i + 1).padStart(2)}. ${m}`);
  if (models.length > max) {
    lines.push(`  ... and ${models.length - max} more`);
  }
  return lines.join('\n');
}
