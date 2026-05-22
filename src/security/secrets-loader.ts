import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { registerKnownSecret } from './scrubber.js';

export interface CarrierConfig {
  carrier: 'openrouter' | 'openai' | 'custom';
  apiKey?: string;
  baseUrl: string;
  model: string;
  timeout: number;
  profile: 'strict' | 'normal' | 'override';
  dryRun: boolean;
}

export function loadConfig(): CarrierConfig {
  const configMap = new Map<string, string>();

  // 1. Gather search file paths from lowest to highest priority
  const cwd = process.cwd();
  const homeDir = os.homedir();
  const filePaths = [
    ...(process.env.GETIT_TEST_MODE === 'true' ? [] : [path.join(homeDir, '.getitrc')]),
    path.join(cwd, '.getitrc'),
    path.join(cwd, '.env'),
  ];

  // Load and parse properties from files
  for (const filePath of filePaths) {
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
          const [key, ...valueParts] = trimmed.split('=');
          const value = valueParts.join('=').trim().replace(/^['"]|['\"]$/g, '');
          if (key && value) {
            configMap.set(key.trim().toUpperCase(), value);
          }
        }
      } catch {
        // Ignore files we can't read
      }
    }
  }

  // Priority search parameter helper
  const getParam = (keys: string[]): string | undefined => {
    // A. Highest priority: Process environment variables
    for (const key of keys) {
      if (process.env[key.toUpperCase()]) {
        return process.env[key.toUpperCase()];
      }
    }
    // B. Fallback priority: Persistence files
    for (const key of keys) {
      if (configMap.has(key.toUpperCase())) {
        return configMap.get(key.toUpperCase());
      }
    }
    return undefined;
  };

  // 1. Resolve Carrier
  const rawCarrier = getParam(['GETIT_CARRIER', 'CARRIER']);
  let carrier: 'openrouter' | 'openai' | 'custom' = 'openrouter';
  if (rawCarrier) {
    const norm = rawCarrier.trim().toLowerCase();
    if (norm === 'openai') {
      carrier = 'openai';
    } else if (norm === 'custom' || norm === 'local') {
      carrier = 'custom';
    }
  }

  // 2. Resolve API Key
  const apiKey = getParam(['GETIT_API_KEY', 'API_KEY', 'OPENROUTER_API_KEY']);
  if (apiKey) {
    process.env.GETIT_API_KEY = apiKey;
    process.env.OPENROUTER_API_KEY = apiKey;
    registerKnownSecret(apiKey);
  }

  // 3. Resolve Base URL
  let baseUrl = getParam(['GETIT_BASE_URL', 'BASE_URL']);
  if (!baseUrl) {
    if (carrier === 'openrouter') {
      baseUrl = 'https://openrouter.ai/api/v1';
    } else if (carrier === 'openai') {
      baseUrl = 'https://api.openai.com/v1';
    } else {
      baseUrl = 'http://localhost:11434/v1';
    }
  } else {
    // Strip trailing slash if present
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1);
    }
  }

  // 4. Resolve Model
  let model = getParam(['GETIT_MODEL', 'MODEL', 'OPENROUTER_MODEL']);
  if (!model) {
    if (carrier === 'openrouter') {
      model = 'nvidia/nemotron-3-super-120b-a12b:free';
    } else if (carrier === 'openai') {
      model = 'gpt-4o';
    } else {
      model = 'llama3';
    }
  }

  // 5. Resolve Timeout
  const rawTimeout = getParam(['GETIT_TIMEOUT', 'TIMEOUT']);
  let timeout = 60000;
  if (rawTimeout) {
    const parsed = parseInt(rawTimeout, 10);
    if (!isNaN(parsed) && parsed > 0) {
      timeout = parsed;
    }
  }

  // 6. Resolve Security Profile
  const rawProfile = getParam(['GETIT_PROFILE', 'PROFILE']);
  let profile: 'strict' | 'normal' | 'override' = 'normal';
  if (rawProfile) {
    const norm = rawProfile.trim().toLowerCase();
    if (['strict', 'normal', 'override'].includes(norm)) {
      profile = norm as any;
    }
  }

  // 7. Resolve Dry Run
  const rawDryRun = getParam(['GETIT_DRY_RUN', 'DRY_RUN']);
  let dryRun = false;
  if (rawDryRun) {
    const norm = rawDryRun.trim().toLowerCase();
    dryRun = norm === 'true' || norm === '1' || norm === 'yes';
  }

  return {
    carrier,
    apiKey,
    baseUrl,
    model,
    timeout,
    profile,
    dryRun,
  };
}

export function loadApiKey(): string | undefined {
  return loadConfig().apiKey;
}
