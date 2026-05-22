import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getReadlineInterface } from '../mitl/interceptor.js';
import { stripAnsi, centerBlock, centerPrompt } from '../ui/layout.js';
import { registerKnownSecret } from '../security/scrubber.js';

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

  const formattedLines = lines.map(line => {
    const visibleLength = stripAnsi(line).length;
    const padRight = Math.max(0, (width - 6) - visibleLength);
    return `\x1b[1;36m║\x1b[0m  ${line}${' '.repeat(padRight)}  \x1b[1;36m║\x1b[0m`;
  });

  return [top, formattedTitle, mid, ...formattedLines, bot].join('\n');
}

export async function runSetupWizard(): Promise<string> {
  const rl = getReadlineInterface();

  console.log('');
  const welcomeCard = buildCard('⚙  GETIT CONFIGURATION ASSISTANT', [
    '\x1b[1;37mWelcome to the universal configuration wizard!\x1b[0m',
    'This guide will statefully set up your LLM carrier',
    'endpoint, execution boundaries, and safety policies.',
  ]);
  console.log(centerBlock(welcomeCard));
  console.log('');

  // Step 1: Select Carrier
  const carrierCard = buildCard('STEP 1: SELECT LLM PROVIDER', [
    'Choose your preferred LLM carrier:',
    '  \x1b[1;37m1)\x1b[0m OpenRouter (Standard proxy endpoint)',
    '  \x1b[1;37m2)\x1b[0m OpenAI     (Direct OpenAI Developer API)',
    '  \x1b[1;37m3)\x1b[0m Custom     (Ollama, DeepSeek, LocalAI, vLLM)',
  ]);
  console.log(centerBlock(carrierCard));
  console.log('');

  let carrierChoice = '';
  while (!['1', '2', '3'].includes(carrierChoice)) {
    const prompt = centerPrompt('\x1b[1;33mSelect option [1-3] ❯ \x1b[0m');
    const raw = await rl.question(prompt);
    carrierChoice = raw.trim();
    if (!['1', '2', '3'].includes(carrierChoice)) {
      console.log(centerBlock('\x1b[31m  Please enter 1, 2, or 3.\x1b[0m'));
    }
  }

  let carrier: 'openrouter' | 'openai' | 'custom' = 'openrouter';
  if (carrierChoice === '2') {
    carrier = 'openai';
  } else if (carrierChoice === '3') {
    carrier = 'custom';
  }

  // Step 2: Collect API Key (skip if custom/local doesn't need one)
  console.log('');
  const keyCard = buildCard('STEP 2: CONFIGURE API KEY', [
    carrier === 'openrouter' ? 'You need an API key from \x1b[1;4;37mhttps://openrouter.ai\x1b[0m' :
    carrier === 'openai' ? 'You need an API key from \x1b[1;4;37mhttps://platform.openai.com\x1b[0m' :
    'Enter API key if your custom endpoint requires auth.',
    carrier === 'custom' ? '(Press [Enter] to skip if using local Ollama without auth)' : 'Please copy and paste your key below.'
  ]);
  console.log(centerBlock(keyCard));
  console.log('');

  let apiKey = '';
  while (true) {
    const prompt = centerPrompt(`\x1b[1;33mEnter API Key ❯ \x1b[0m`);
    const raw = await rl.question(prompt);
    apiKey = raw.trim();
    if (!apiKey) {
      if (carrier === 'custom') {
        break;
      }
      console.log(centerBlock('\x1b[31m  Key cannot be empty. Please try again.\x1b[0m'));
    } else {
      break;
    }
  }

  if (apiKey) {
    registerKnownSecret(apiKey);
    console.log(centerBlock('\x1b[32m  ✓ Key received and securely registered in memory.\x1b[0m'));
  }

  // Step 3: Collect Base URL (only if Custom)
  let baseUrl = '';
  if (carrier === 'custom') {
    console.log('');
    const urlCard = buildCard('STEP 3: CUSTOM ENDPOINT BASE URL', [
      'Specify the base address of your target server:',
      '  - Ollama:    \x1b[1;37mhttp://localhost:11434/v1\x1b[0m (default)',
      '  - DeepSeek:  \x1b[1;37mhttps://api.deepseek.com/v1\x1b[0m',
      '  - LocalAI:   \x1b[1;37mhttp://localhost:8080/v1\x1b[0m',
    ]);
    console.log(centerBlock(urlCard));
    console.log('');

    while (!baseUrl) {
      const prompt = centerPrompt('\x1b[1;33mBase URL [Default: http://localhost:11434/v1] ❯ \x1b[0m');
      const raw = await rl.question(prompt);
      baseUrl = raw.trim();
      if (!baseUrl) {
        baseUrl = 'http://localhost:11434/v1';
      }
      if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
        console.log(centerBlock('\x1b[31m  Invalid protocol. URL must start with http:// or https://\x1b[0m'));
        baseUrl = '';
      }
    }
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1);
    }
  } else {
    baseUrl = carrier === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1';
  }

  // Step 4: Select Model Name
  let defaultModel = 'nvidia/nemotron-3-super-120b-a12b:free';
  if (carrier === 'openai') {
    defaultModel = 'gpt-4o';
  } else if (carrier === 'custom') {
    defaultModel = 'llama3';
  }

  console.log('');
  const modelCard = buildCard('STEP 4: MODEL SELECTION', [
    'Specify the default LLM model name to invoke:',
    `  Default for this carrier: \x1b[1;37m${defaultModel}\x1b[0m`,
    '  (Press [Enter] to keep the default, or type a custom one)',
  ]);
  console.log(centerBlock(modelCard));
  console.log('');

  const modelPrompt = centerPrompt(`\x1b[1;33mModel Name [${defaultModel}] ❯ \x1b[0m`);
  const rawModel = await rl.question(modelPrompt);
  const model = rawModel.trim() || defaultModel;

  // Step 5: Options & Safety Settings
  console.log('');
  const settingsCard = buildCard('STEP 5: BOUNDARY & TIMEOUT SETTINGS', [
    'Configure execution and safety parameters:',
    '  - Command Exec Timeout: Max runtime for shell processes.',
    '  - Security profile: strict, normal, or override.',
    '  - Dry-Run: Safe preview stage mode.',
  ]);
  console.log(centerBlock(settingsCard));
  console.log('');

  // 5.1 Timeout
  const timeoutPrompt = centerPrompt('\x1b[1;33mExecution Timeout (ms) [Default: 60000] ❯ \x1b[0m');
  const rawTimeout = await rl.question(timeoutPrompt);
  const parsedTimeout = parseInt(rawTimeout.trim(), 10);
  const timeout = !isNaN(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 60000;

  // 5.2 Security Profile
  console.log('');
  const profileCard = buildCard('SELECT DEFAULT SECURITY PROFILE', [
    'Choose default directory boundary restriction:',
    '  \x1b[1;37m1)\x1b[0m normal    (Standard workspace policy rules - recommended)',
    '  \x1b[1;37m2)\x1b[0m strict    (Heavy Cascades / System level protection)',
    '  \x1b[1;37m3)\x1b[0m override  (Relax directory boundary controls)',
  ]);
  console.log(centerBlock(profileCard));
  console.log('');

  let profileChoice = '';
  while (!['1', '2', '3'].includes(profileChoice)) {
    const prompt = centerPrompt('\x1b[1;33mSelect option [1-3] ❯ \x1b[0m');
    const raw = await rl.question(prompt);
    profileChoice = raw.trim();
    if (!['1', '2', '3'].includes(profileChoice)) {
      console.log(centerBlock('\x1b[31m  Please enter 1, 2, or 3.\x1b[0m'));
    }
  }
  const profile = profileChoice === '2' ? 'strict' : profileChoice === '3' ? 'override' : 'normal';

  // 5.3 Dry-Run
  console.log('');
  const dryCard = buildCard('DEFAULT DRY-RUN PLANNING MODE', [
    'Enable dry-run preview by default?',
    '  - If enabled, the agent lists plans without running commands.',
    '  \x1b[1;37m1)\x1b[0m Off (Execute mutations with MITL confirmation - default)',
    '  \x1b[1;37m2)\x1b[0m On  (Staged preview-only by default)',
  ]);
  console.log(centerBlock(dryCard));
  console.log('');

  let dryChoice = '';
  while (!['1', '2'].includes(dryChoice)) {
    const prompt = centerPrompt('\x1b[1;33mSelect option [1-2] ❯ \x1b[0m');
    const raw = await rl.question(prompt);
    dryChoice = raw.trim();
    if (!['1', '2'].includes(dryChoice)) {
      console.log(centerBlock('\x1b[31m  Please enter 1 or 2.\x1b[0m'));
    }
  }
  const dryRun = dryChoice === '2';

  // Step 6: Choose target location to save
  console.log('');
  const targetCard = buildCard('STEP 6: PERSIST CONFIGURATIONS', [
    'Choose where to save these settings:',
    '  \x1b[1;37m1)\x1b[0m .env         (current directory)',
    '  \x1b[1;37m2)\x1b[0m .getitrc     (current directory)',
    '  \x1b[1;37m3)\x1b[0m ~/.getitrc   (home directory — works globally)',
    '  \x1b[1;37m4)\x1b[0m Don\'t save   (session-only, lost on exit)',
  ]);
  console.log(centerBlock(targetCard));
  console.log('');

  let saveChoice = '';
  while (!['1', '2', '3', '4'].includes(saveChoice)) {
    const prompt = centerPrompt('\x1b[1;33mSelect option [1-4] ❯ \x1b[0m');
    const raw = await rl.question(prompt);
    saveChoice = raw.trim();
    if (!['1', '2', '3', '4'].includes(saveChoice)) {
      console.log(centerBlock('\x1b[31m  Please enter 1, 2, 3, or 4.\x1b[0m'));
    }
  }

  // Prepare key configurations
  const finalConfig: Record<string, string> = {
    GETIT_CARRIER: carrier,
    GETIT_BASE_URL: baseUrl,
    GETIT_MODEL: model,
    GETIT_TIMEOUT: String(timeout),
    GETIT_PROFILE: profile,
    GETIT_DRY_RUN: String(dryRun),
  };
  if (apiKey) {
    finalConfig.GETIT_API_KEY = apiKey;
  }

  // Stateful write operation
  if (saveChoice !== '4') {
    let targetFile = '';
    if (saveChoice === '1') {
      targetFile = path.join(process.cwd(), '.env');
    } else if (saveChoice === '2') {
      targetFile = path.join(process.cwd(), '.getitrc');
    } else if (saveChoice === '3') {
      targetFile = path.join(os.homedir(), '.getitrc');
    }

    writeConfigToFile(targetFile, finalConfig);
    console.log('');
    console.log(centerBlock(`\x1b[32m  ✓ Configurations saved statefully to ${targetFile}\x1b[0m`));
  } else {
    console.log('');
    console.log(centerBlock('\x1b[33m  ✓ Configurations stored for this session only.\x1b[0m'));
  }

  // Populate active process environment variables for this running session
  for (const [k, v] of Object.entries(finalConfig)) {
    process.env[k] = v;
  }
  // Backwards compatibility env keys
  if (apiKey) {
    process.env.OPENROUTER_API_KEY = apiKey;
  }

  console.log('');
  console.log(centerBlock('\x1b[1;32m✓ GETIT WAS CONFIGURED SUCCESSFULY!\x1b[0m'));
  console.log('');

  return apiKey;
}

function writeConfigToFile(filePath: string, config: Record<string, string>): void {
  let content = '';
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf-8');
  }

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

  // Append new key-values at bottom
  for (const [key, val] of Object.entries(config)) {
    if (!updatedKeys.has(key.toUpperCase())) {
      lines.push(`${key}=${val}`);
    }
  }

  fs.writeFileSync(filePath, lines.join('\n').trim() + '\n', 'utf-8');
}
