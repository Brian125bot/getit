import { CarrierId, getPreset, resolveActivePreset } from './registry.js';
import { clearModelCache } from './models.js';

/** Apply in-process carrier switch (session override via env). */
export function switchCarrier(carrierId: CarrierId, overrides?: { baseUrl?: string; apiKey?: string }): void {
  const preset = resolveActivePreset(carrierId, overrides?.baseUrl);
  process.env.GETIT_CARRIER = preset.id;
  process.env.GETIT_BASE_URL = preset.baseUrl;
  if (overrides?.apiKey) {
    process.env.GETIT_API_KEY = overrides.apiKey;
  }
  clearModelCache();
}

export function switchModel(model: string): void {
  process.env.GETIT_MODEL = model;
}
