import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export function loadApiKey(): string | undefined {
  // 1. Direct environment variable takes absolute priority
  if (process.env.OPENROUTER_API_KEY) {
    return process.env.OPENROUTER_API_KEY;
  }

  // 2. Fallback to scanning for .env or .getitrc in the current working directory
  //    and ~/.getitrc in the home directory
  const cwd = process.cwd();
  const homeDir = os.homedir();

  const searchPaths = [
    path.join(cwd, '.env'),
    path.join(cwd, '.getitrc'),
    ...(process.env.GETIT_TEST_MODE === 'true' ? [] : [path.join(homeDir, '.getitrc')]),
  ];

  for (const filePath of searchPaths) {
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
          const [key, ...valueParts] = trimmed.split('=');
          const value = valueParts.join('=').trim().replace(/^['"]|['"]$/g, ''); // strip optional quotes
          if (key.trim() === 'OPENROUTER_API_KEY' && value) {
            process.env.OPENROUTER_API_KEY = value;
            return value;
          }
        }
      } catch {
        // Ignore files we can't read
      }
    }
  }

  return undefined;
}
