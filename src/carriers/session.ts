import { CarrierId, getPreset, resolveActivePreset } from './registry.js';
import { clearModelCache } from './models.js';
import { registerKnownSecret } from '../security/scrubber.js';

// In-session API key override (held in closure, not process.env)
let _sessionApiKeyOverride: string | undefined;

export function getSessionApiKeyOverride(): string | undefined {
  return _sessionApiKeyOverride;
}

/** Apply in-process carrier switch (session override via env). */
export function switchCarrier(carrierId: CarrierId, overrides?: { baseUrl?: string; apiKey?: string }): void {
  const preset = resolveActivePreset(carrierId, overrides?.baseUrl);
  process.env.GETIT_CARRIER = preset.id;
  process.env.GETIT_BASE_URL = preset.baseUrl;
  if (overrides?.apiKey) {
    // Store in module-level closure only — never in process.env
    _sessionApiKeyOverride = overrides.apiKey;
    registerKnownSecret(overrides.apiKey);
  }
  clearModelCache();
}

export function switchModel(model: string): void {
  process.env.GETIT_MODEL = model;
}
