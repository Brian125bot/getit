import { execSync } from 'node:child_process';
import { loadConfig } from '../security/secrets-loader.js';
import { resolveActivePreset } from './registry.js';
import { pingCarrier } from './transport.js';

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export async function runDoctorChecks(): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const config = loadConfig();
  const preset = resolveActivePreset(config.carrier, config.baseUrl);

  checks.push({
    name: 'Node.js',
    ok: true,
    detail: process.version,
  });

  checks.push({
    name: 'Carrier config',
    ok: true,
    detail: `${preset.displayName} → ${config.baseUrl}`,
  });

  checks.push({
    name: 'API key',
    ok: preset.auth === 'none' || !!config.apiKey,
    detail: config.apiKey ? 'Configured (redacted)' : preset.auth === 'none' ? 'Not required' : 'Missing',
  });

  const ping = await pingCarrier(preset, config.apiKey, 8000);
  checks.push({
    name: 'Carrier connectivity',
    ok: ping.ok,
    detail: ping.message,
  });

  try {
    execSync('git --version', { stdio: 'pipe' });
    checks.push({ name: 'git', ok: true, detail: 'Available' });
  } catch {
    checks.push({ name: 'git', ok: false, detail: 'Not found (workspace tracking limited)' });
  }

  try {
    execSync('gh --version', { stdio: 'pipe' });
    checks.push({ name: 'gh CLI', ok: true, detail: 'Available' });
  } catch {
    checks.push({ name: 'gh CLI', ok: false, detail: 'Not found (remote sync unavailable)' });
  }

  return checks;
}
