import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { registerKnownSecret } from './scrubber.js';
import {
  CarrierId,
  CarrierPreset,
  normalizeCarrierId,
  inferCarrierId,
  resolveActivePreset,
  requiresApiKey,
} from '../carriers/registry.js';

export type { CarrierId };

export interface CarrierConfig {
  carrier: CarrierId;
  apiKey?: string;
  baseUrl: string;
  model: string;
  timeout: number;
  profile: 'strict' | 'normal' | 'override';
  dryRun: boolean;
  azureResource?: string;
  azureDeployment?: string;
}

function buildConfigMap(): Map<string, string> {
  const configMap = new Map<string, string>();
  const cwd = process.cwd();
  const homeDir = os.homedir();
  const filePaths = [
    ...(process.env.GETIT_TEST_MODE === 'true' ? [] : [path.join(homeDir, '.getitrc')]),
    path.join(cwd, '.getitrc'),
    path.join(cwd, '.env'),
  ];

  for (const filePath of filePaths) {
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
          const [key, ...valueParts] = trimmed.split('=');
          const value = valueParts.join('=').trim().replace(/^['"]|['"]$/g, '');
          if (key && value) {
            configMap.set(key.trim().toUpperCase(), value);
          }
        }
      } catch {
        // Ignore unreadable files
      }
    }
  }
  return configMap;
}

function getParam(configMap: Map<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    if (process.env[key.toUpperCase()]) {
      return process.env[key.toUpperCase()];
    }
  }
  for (const key of keys) {
    if (configMap.has(key.toUpperCase())) {
      return configMap.get(key.toUpperCase());
    }
  }
  return undefined;
}

function resolveApiKey(preset: CarrierPreset, configMap: Map<string, string>): string | undefined {
  for (const envKey of preset.keyEnvVars) {
    const fromEnv = process.env[envKey.toUpperCase()];
    if (fromEnv) return fromEnv;
  }
  for (const envKey of preset.keyEnvVars) {
    const fromFile = configMap.get(envKey.toUpperCase());
    if (fromFile) return fromFile;
  }
  return undefined;
}

export function loadConfig(): CarrierConfig {
  const configMap = buildConfigMap();

  const rawCarrier = getParam(configMap, ['GETIT_CARRIER', 'CARRIER']);
  let carrier = normalizeCarrierId(rawCarrier);

  let baseUrl = getParam(configMap, ['GETIT_BASE_URL', 'BASE_URL']);
  carrier = inferCarrierId(carrier, baseUrl);

  const preset = resolveActivePreset(carrier, baseUrl);
  baseUrl = preset.baseUrl;

  const apiKey = resolveApiKey(preset, configMap);
  if (apiKey) {
    process.env.GETIT_API_KEY = apiKey;
    registerKnownSecret(apiKey);
  }

  let model = getParam(configMap, ['GETIT_MODEL', 'MODEL', 'OPENROUTER_MODEL']);
  if (!model) {
    model = preset.defaultModel;
  }

  const rawTimeout = getParam(configMap, ['GETIT_TIMEOUT', 'TIMEOUT']);
  let timeout = 60000;
  if (rawTimeout) {
    const parsed = parseInt(rawTimeout, 10);
    if (!isNaN(parsed) && parsed > 0) {
      timeout = parsed;
    }
  }

  const rawProfile = getParam(configMap, ['GETIT_PROFILE', 'PROFILE']);
  let profile: 'strict' | 'normal' | 'override' = 'normal';
  if (rawProfile) {
    const norm = rawProfile.trim().toLowerCase();
    if (['strict', 'normal', 'override'].includes(norm)) {
      profile = norm as 'strict' | 'normal' | 'override';
    }
  }

  const rawDryRun = getParam(configMap, ['GETIT_DRY_RUN', 'DRY_RUN']);
  let dryRun = false;
  if (rawDryRun) {
    const norm = rawDryRun.trim().toLowerCase();
    dryRun = norm === 'true' || norm === '1' || norm === 'yes';
  }

  const azureResource = getParam(configMap, ['GETIT_AZURE_RESOURCE', 'AZURE_OPENAI_RESOURCE']);
  const azureDeployment = getParam(configMap, ['GETIT_AZURE_DEPLOYMENT', 'AZURE_OPENAI_DEPLOYMENT']);

  if (carrier === 'azure' && azureResource && azureDeployment) {
    baseUrl = `https://${azureResource}.openai.azure.com/openai/deployments/${azureDeployment}`;
  }

  return {
    carrier: preset.id,
    apiKey,
    baseUrl,
    model,
    timeout,
    profile,
    dryRun,
    azureResource,
    azureDeployment,
  };
}

export function loadApiKey(): string | undefined {
  return loadConfig().apiKey;
}

export function getActivePreset(): CarrierPreset {
  const config = loadConfig();
  return resolveActivePreset(config.carrier, config.baseUrl);
}

export function configRequiresApiKey(config: CarrierConfig = loadConfig()): boolean {
  const preset = resolveActivePreset(config.carrier, config.baseUrl);
  return requiresApiKey(preset);
}

export function getApiKeyEnvHints(carrierId: CarrierId = loadConfig().carrier): string {
  const preset = resolveActivePreset(carrierId);
  return preset.keyEnvVars.slice(0, 3).join(', ');
}
