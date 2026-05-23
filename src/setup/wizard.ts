import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { getReadlineInterface } from '../mitl/interceptor.js';
import { stripAnsi, centerBlock, centerPrompt } from '../ui/layout.js';
import { registerKnownSecret } from '../security/scrubber.js';
import {
  listCarrierPresets,
  CarrierId,
  CarrierPreset,
  getPreset,
  buildAzureBaseUrl,
} from '../carriers/registry.js';
import { pingCarrier } from '../carriers/transport.js';
import { listModels, formatModelList } from '../carriers/models.js';

function padCenter(text: string, width: number): string {
  const visible = stripAnsi(text).length;
  const padding = Math.floor((width - visible) / 2);
  const left = ' '.repeat(Math.max(0, padding));
  const right = ' '.repeat(Math.max(0, width - visible - padding));
  return left + text + right;
}

function buildCard(title: string, lines: string[]): string {
  const width = 58;
  const top = `\x1b[1;36m╔${'═'.repeat(width - 2)}╗\x1b[0m`;
  const mid = `\x1b[1;36m╟${'─'.repeat(width - 2)}╢\x1b[0m`;
  const bot = `\x1b[1;36m╚${'═'.repeat(width - 2)}╝\x1b[0m`;
  const formattedTitle = `\x1b[1;36m║\x1b[1;33m${padCenter(title, width - 2)}\x1b[1;36m║\x1b[0m`;
  const formattedLines = lines.map((line) => {
    const visibleLength = stripAnsi(line).length;
    const padRight = Math.max(0, (width - 6) - visibleLength);
    return `\x1b[1;36m║\x1b[0m  ${line}${' '.repeat(padRight)}  \x1b[1;36m║\x1b[0m`;
  });
  return [top, formattedTitle, mid, ...formattedLines, bot].join('\n');
}

export async function runSetupWizard(): Promise<string> {
  const rl = getReadlineInterface();
  const presets = listCarrierPresets().filter((p) => p.id !== 'custom');

  console.log('');
  console.log(centerBlock(buildCard('GETIT CONFIGURATION ASSISTANT', [
    'Configure your LLM carrier, model, and safety defaults.',
    'Supports OpenRouter, OpenAI, Anthropic, Gemini, Groq,',
    'DeepSeek, Together, Mistral, Azure, and local Ollama.',
  ])));

  // Step 1: Pick carrier
  const carrierLines = presets.map((p, i) => `  \x1b[1;37m${i + 1})\x1b[0m ${p.displayName}`);
  carrierLines.push(`  \x1b[1;37m${presets.length + 1})\x1b[0m Custom Endpoint`);
  console.log('\n' + centerBlock(buildCard('STEP 1: SELECT LLM PROVIDER', carrierLines)) + '\n');

  let carrierChoice = '';
  const maxChoice = presets.length + 1;
  while (!carrierChoice || parseInt(carrierChoice, 10) < 1 || parseInt(carrierChoice, 10) > maxChoice) {
    const raw = await rl.question(centerPrompt(`\x1b[1;33mSelect option [1-${maxChoice}] ❯ \x1b[0m`));
    carrierChoice = raw.trim();
    if (!carrierChoice || parseInt(carrierChoice, 10) < 1 || parseInt(carrierChoice, 10) > maxChoice) {
      console.log(centerBlock(`\x1b[31m  Please enter 1-${maxChoice}.\x1b[0m`));
      carrierChoice = '';
    }
  }

  const choiceIdx = parseInt(carrierChoice, 10) - 1;
  let carrierId: CarrierId = choiceIdx < presets.length ? presets[choiceIdx].id : 'custom';
  let preset: CarrierPreset = choiceIdx < presets.length ? { ...presets[choiceIdx] } : getPreset('custom');

  // Step 2: API key
  console.log('\n' + centerBlock(buildCard('STEP 2: API KEY', [
    preset.auth === 'none'
      ? 'No API key required for this carrier.'
      : `Get a key from: \x1b[1;4;37m${preset.docsUrl || 'your provider dashboard'}\x1b[0m`,
    preset.auth === 'none' ? '(Press Enter to skip)' : 'Paste your API key below.',
  ])) + '\n');

  let apiKey = '';
  if (preset.auth !== 'none') {
    while (true) {
      const raw = await rl.question(centerPrompt('\x1b[1;33mEnter API Key ❯ \x1b[0m'));
      apiKey = raw.trim();
      if (apiKey) break;
      console.log(centerBlock('\x1b[31m  Key cannot be empty. Press Enter only if switching to Ollama.\x1b[0m'));
    }
    registerKnownSecret(apiKey);
    console.log(centerBlock('\x1b[32m  Key received and registered for scrubbing.\x1b[0m'));
  } else {
    await rl.question(centerPrompt('\x1b[1;33mPress Enter to continue ❯ \x1b[0m'));
  }

  // Step 3: Endpoint (custom / azure)
  let baseUrl = preset.baseUrl;
  let azureResource = '';
  let azureDeployment = '';

  if (carrierId === 'azure') {
    console.log('\n' + centerBlock(buildCard('STEP 3: AZURE OPENAI', [
      'Enter your Azure OpenAI resource and deployment names.',
    ])) + '\n');
    while (!azureResource) {
      const raw = await rl.question(centerPrompt('\x1b[1;33mAzure resource name ❯ \x1b[0m'));
      azureResource = raw.trim();
    }
    while (!azureDeployment) {
      const raw = await rl.question(centerPrompt('\x1b[1;33mDeployment name ❯ \x1b[0m'));
      azureDeployment = raw.trim();
    }
    baseUrl = buildAzureBaseUrl(azureResource, azureDeployment);
    preset = { ...preset, baseUrl };
  } else if (carrierId === 'custom') {
    console.log('\n' + centerBlock(buildCard('STEP 3: CUSTOM BASE URL', [
      'Examples:',
      '  Ollama:   http://localhost:11434/v1',
      '  LocalAI:  http://localhost:8080/v1',
    ])) + '\n');
    while (!baseUrl) {
      const raw = await rl.question(centerPrompt('\x1b[1;33mBase URL [http://localhost:11434/v1] ❯ \x1b[0m'));
      baseUrl = raw.trim() || 'http://localhost:11434/v1';
      if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
        console.log(centerBlock('\x1b[31m  URL must start with http:// or https://\x1b[0m'));
        baseUrl = '';
      }
    }
    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
    preset = { ...preset, baseUrl };
  }

  // Step 4: Connection test
  console.log('\n' + centerBlock(buildCard('STEP 4: CONNECTION TEST', [
    'Testing connectivity to the carrier endpoint...',
  ])) + '\n');

  const ping = await pingCarrier(preset, apiKey || undefined);
  const pingColor = ping.ok ? '\x1b[32m' : '\x1b[31m';
  console.log(centerBlock(`${pingColor}  ${ping.message}\x1b[0m`));

  if (!ping.ok && preset.auth !== 'none') {
    const cont = await rl.question(centerPrompt('\x1b[1;33mContinue anyway? [y/N] ❯ \x1b[0m'));
    if (cont.trim().toLowerCase() !== 'y') {
      throw new Error('Setup aborted due to connection failure.');
    }
  }

  // Step 5: Model selection
  console.log('\n' + centerBlock(buildCard('STEP 5: MODEL SELECTION', [
    'Fetching available models (or using default)...',
  ])) + '\n');

  const models = await listModels(preset, apiKey || undefined, { forceRefresh: true });
  if (models.length > 1) {
    console.log(centerBlock(`\x1b[1;37mAvailable models:\x1b[0m\n${formatModelList(models, 15)}`));
    console.log('');
    const pick = await rl.question(centerPrompt(
      `\x1b[1;33mEnter number or model id [default: ${preset.defaultModel}] ❯ \x1b[0m`
    ));
    const trimmed = pick.trim();
    if (trimmed) {
      const num = parseInt(trimmed, 10);
      if (!isNaN(num) && num >= 1 && num <= models.length) {
        preset.defaultModel = models[num - 1];
      } else {
        preset.defaultModel = trimmed;
      }
    }
  } else {
    const modelPrompt = await rl.question(centerPrompt(
      `\x1b[1;33mModel name [${preset.defaultModel}] ❯ \x1b[0m`
    ));
    if (modelPrompt.trim()) preset.defaultModel = modelPrompt.trim();
  }

  if (!preset.supportsTools) {
    console.log(centerBlock('\x1b[33m  Warning: This carrier may not support tool calling.\x1b[0m'));
  }

  // Step 6: Safety settings
  console.log('\n' + centerBlock(buildCard('STEP 6: SAFETY & TIMEOUT', [
    'Execution timeout, policy profile, and dry-run mode.',
  ])) + '\n');

  const rawTimeout = await rl.question(centerPrompt('\x1b[1;33mTimeout (ms) [60000] ❯ \x1b[0m'));
  const parsedTimeout = parseInt(rawTimeout.trim(), 10);
  const timeout = !isNaN(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 60000;

  console.log(centerBlock(buildCard('SECURITY PROFILE', [
    '  \x1b[1;37m1)\x1b[0m normal    (recommended)',
    '  \x1b[1;37m2)\x1b[0m strict',
    '  \x1b[1;37m3)\x1b[0m override',
  ])));
  let profileChoice = '';
  while (!['1', '2', '3'].includes(profileChoice)) {
    profileChoice = (await rl.question(centerPrompt('\x1b[1;33mSelect [1-3] ❯ \x1b[0m'))).trim();
  }
  const profile = profileChoice === '2' ? 'strict' : profileChoice === '3' ? 'override' : 'normal';

  let dryChoice = '';
  while (!['1', '2'].includes(dryChoice)) {
    dryChoice = (await rl.question(centerPrompt('\x1b[1;33mDry-run default? 1=Off 2=On ❯ \x1b[0m'))).trim();
  }
  const dryRun = dryChoice === '2';

  // Step 7: Persist
  console.log('\n' + centerBlock(buildCard('STEP 7: SAVE CONFIGURATION', [
    '  \x1b[1;37m1)\x1b[0m .env (current directory)',
    '  \x1b[1;37m2)\x1b[0m .getitrc (current directory)',
    '  \x1b[1;37m3)\x1b[0m ~/.getitrc (global)',
    '  \x1b[1;37m4)\x1b[0m Session only',
  ])) + '\n');

  let saveChoice = '';
  while (!['1', '2', '3', '4'].includes(saveChoice)) {
    saveChoice = (await rl.question(centerPrompt('\x1b[1;33mSelect [1-4] ❯ \x1b[0m'))).trim();
  }

  const finalConfig: Record<string, string> = {
    GETIT_CARRIER: carrierId,
    GETIT_BASE_URL: baseUrl,
    GETIT_MODEL: preset.defaultModel,
    GETIT_TIMEOUT: String(timeout),
    GETIT_PROFILE: profile,
    GETIT_DRY_RUN: String(dryRun),
  };
  if (apiKey) finalConfig.GETIT_API_KEY = apiKey;
  if (azureResource) finalConfig.GETIT_AZURE_RESOURCE = azureResource;
  if (azureDeployment) finalConfig.GETIT_AZURE_DEPLOYMENT = azureDeployment;

  if (saveChoice !== '4') {
    const targetFile =
      saveChoice === '1' ? path.join(process.cwd(), '.env') :
      saveChoice === '2' ? path.join(process.cwd(), '.getitrc') :
      path.join(os.homedir(), '.getitrc');
    await writeConfigToFile(targetFile, finalConfig);
    console.log(centerBlock(`\x1b[32m  Saved to ${targetFile}\x1b[0m`));
  } else {
    console.log(centerBlock('\x1b[33m  Session-only (not persisted to disk).\x1b[0m'));
  }

  for (const [k, v] of Object.entries(finalConfig)) {
    process.env[k] = v;
  }

  console.log(centerBlock('\x1b[1;32mGETIT CONFIGURED SUCCESSFULLY\x1b[0m'));
  return apiKey;
}

async function writeConfigToFile(filePath: string, config: Record<string, string>): Promise<void> {
  let content = '';
  try {
    await fsp.access(filePath);
    content = await fsp.readFile(filePath, 'utf-8');
  } catch {}

  const lines = content.split('\n');
  const updatedKeys = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#') || !line.includes('=')) continue;
    const [key] = line.split('=');
    const uKey = key.trim().toUpperCase();
    if (config[uKey] !== undefined) {
      lines[i] = `${key.trim()}=${config[uKey]}`;
      updatedKeys.add(uKey);
    }
  }

  for (const [key, val] of Object.entries(config)) {
    if (!updatedKeys.has(key.toUpperCase())) {
      lines.push(`${key}=${val}`);
    }
  }

  await fsp.writeFile(filePath, lines.join('\n').trim() + '\n', 'utf-8');
}
