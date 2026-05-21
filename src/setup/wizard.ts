import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getReadlineInterface } from '../mitl/interceptor.js';

export async function runSetupWizard(): Promise<string> {
  const rl = getReadlineInterface();

  console.log('');
  console.log('\x1b[1;36m┌────────────────────────────────────────────────────────┐');
  console.log('│ \x1b[1;33m⚙  FIRST-TIME SETUP\x1b[1;36m                                    │');
  console.log('├────────────────────────────────────────────────────────┤');
  console.log('│\x1b[0m                                                        \x1b[1;36m│');
  console.log('│\x1b[0m  No OpenRouter API key was detected.                   \x1b[1;36m│');
  console.log('│\x1b[0m  You need a free key from \x1b[1;4;37mhttps://openrouter.ai\x1b[0m       \x1b[1;36m│');
  console.log('│\x1b[0m  to power the LLM backend.                             \x1b[1;36m│');
  console.log('│\x1b[0m                                                        \x1b[1;36m│');
  console.log('│\x1b[0m  Steps:                                                \x1b[1;36m│');
  console.log('│\x1b[0m   1. Visit \x1b[1;37mhttps://openrouter.ai/keys\x1b[0m                  \x1b[1;36m│');
  console.log('│\x1b[0m   2. Create a new key                                  \x1b[1;36m│');
  console.log('│\x1b[0m   3. Paste it below                                    \x1b[1;36m│');
  console.log('│\x1b[0m                                                        \x1b[1;36m│');
  console.log('└────────────────────────────────────────────────────────┘\x1b[0m');
  console.log('');

  // Step 1: Collect the API key
  let apiKey = '';
  while (!apiKey) {
    const raw = await rl.question('\x1b[1;33mPaste your OpenRouter API key ❯ \x1b[0m');
    apiKey = raw.trim();
    if (!apiKey) {
      console.log('\x1b[31m  Key cannot be empty. Please try again.\x1b[0m');
    }
    if (apiKey && !apiKey.startsWith('sk-')) {
      console.log('\x1b[33m  ⚠ Key does not start with "sk-". This may be invalid, but proceeding.\x1b[0m');
    }
  }

  // Step 2: Ask where to save it
  console.log('');
  console.log('\x1b[1;36mWhere would you like to save this key?\x1b[0m');
  console.log('  \x1b[1;37m1)\x1b[0m .env         (current directory)');
  console.log('  \x1b[1;37m2)\x1b[0m .getitrc     (current directory)');
  console.log('  \x1b[1;37m3)\x1b[0m ~/.getitrc   (home directory — works from any folder)');
  console.log('  \x1b[1;37m4)\x1b[0m Don\'t save   (session-only, lost on exit)');
  console.log('');

  let choice = '';
  while (!['1', '2', '3', '4'].includes(choice)) {
    const raw = await rl.question('\x1b[1;33mSelect option [1-4] ❯ \x1b[0m');
    choice = raw.trim();
    if (!['1', '2', '3', '4'].includes(choice)) {
      console.log('\x1b[31m  Please enter 1, 2, 3, or 4.\x1b[0m');
    }
  }

  // Step 3: Write the key
  const keyLine = `OPENROUTER_API_KEY=${apiKey}\n`;

  if (choice === '1') {
    const target = path.join(process.cwd(), '.env');
    appendOrCreateKeyFile(target, keyLine);
    console.log(`\x1b[32m  ✓ Saved to ${target}\x1b[0m`);
  } else if (choice === '2') {
    const target = path.join(process.cwd(), '.getitrc');
    appendOrCreateKeyFile(target, keyLine);
    console.log(`\x1b[32m  ✓ Saved to ${target}\x1b[0m`);
  } else if (choice === '3') {
    const target = path.join(os.homedir(), '.getitrc');
    appendOrCreateKeyFile(target, keyLine);
    console.log(`\x1b[32m  ✓ Saved to ${target}\x1b[0m`);
  } else {
    console.log('\x1b[33m  Key stored for this session only.\x1b[0m');
  }

  // Always inject into process.env for the current session
  process.env.OPENROUTER_API_KEY = apiKey;
  console.log('\x1b[32m  ✓ API key configured successfully.\x1b[0m\n');

  return apiKey;
}

function appendOrCreateKeyFile(filePath: string, keyLine: string): void {
  if (fs.existsSync(filePath)) {
    // Check if the key already exists in the file; if so, replace it
    const existing = fs.readFileSync(filePath, 'utf-8');
    if (existing.includes('OPENROUTER_API_KEY=')) {
      const updated = existing.replace(/OPENROUTER_API_KEY=.*/g, keyLine.trim());
      fs.writeFileSync(filePath, updated, 'utf-8');
    } else {
      fs.appendFileSync(filePath, keyLine, 'utf-8');
    }
  } else {
    fs.writeFileSync(filePath, keyLine, 'utf-8');
  }
}
