import { execSync } from 'node:child_process';
import { loadConfig } from '../security/secrets-loader.js';
import { resolveActivePreset } from './registry.js';
import { pingCarrier } from './transport.js';
import { TerminalSpinner } from '../ui/spinner.js';

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export async function runDoctorChecks(): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const config = loadConfig();
  const preset = resolveActivePreset(config.carrier, config.baseUrl);
  const spinner = new TerminalSpinner();

  spinner.start('Checking Node.js');
  checks.push({
    name: 'Node.js',
    ok: true,
    detail: process.version,
  });
  spinner.succeed(`Node.js ${process.version}`);

  spinner.start('Checking Carrier config');
  checks.push({
    name: 'Carrier config',
    ok: true,
    detail: `${preset.displayName} → ${config.baseUrl}`,
  });
  spinner.succeed(`Carrier config ${preset.displayName} → ${config.baseUrl}`);

  spinner.start('Checking API key');
  const apiKeyOk = preset.auth === 'none' || !!config.apiKey;
  const apiKeyDetail = config.apiKey ? 'Configured (redacted)' : preset.auth === 'none' ? 'Not required' : 'Missing';
  checks.push({
    name: 'API key',
    ok: apiKeyOk,
    detail: apiKeyDetail,
  });
  if (apiKeyOk) spinner.succeed(`API key: ${apiKeyDetail}`);
  else spinner.fail(`API key: ${apiKeyDetail}`);

  spinner.start('Checking Carrier connectivity');
  const ping = await pingCarrier(preset, config.apiKey, 8000);
  checks.push({
    name: 'Carrier connectivity',
    ok: ping.ok,
    detail: ping.message,
  });
  if (ping.ok) spinner.succeed(`Carrier connectivity: ${ping.message}`);
  else spinner.fail(`Carrier connectivity: ${ping.message}`);

  spinner.start('Checking git');
  try {
    execSync('git --version', { stdio: 'pipe' });
    checks.push({ name: 'git', ok: true, detail: 'Available' });
    spinner.succeed(`git Available`);
  } catch {
    checks.push({ name: 'git', ok: false, detail: 'Not found (workspace tracking limited)' });
    spinner.fail(`git Not found (workspace tracking limited)`);
  }

  spinner.start('Checking gh CLI');
  try {
    execSync('gh --version', { stdio: 'pipe' });
    checks.push({ name: 'gh CLI', ok: true, detail: 'Available' });
    spinner.succeed(`gh CLI Available`);
  } catch {
    checks.push({ name: 'gh CLI', ok: false, detail: 'Not found (remote sync unavailable)' });
    spinner.fail(`gh CLI Not found (remote sync unavailable)`);
  }

  return checks;
}
