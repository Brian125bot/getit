import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

process.env.GETIT_TEST_MODE = 'true';

import { loadConfig } from '../src/security/secrets-loader.js';
import { scrubText, registerKnownSecret } from '../src/security/scrubber.js';

test('Universal Config Suite: Parser and Carrier Defaults', async (t) => {
  const cwd = process.cwd();
  const testEnvFile = path.join(cwd, '.env');
  const testRcFile = path.join(cwd, '.getitrc');

  // Backups of active process.env
  const backupEnvKeys = [
    'GETIT_CARRIER', 'GETIT_API_KEY', 'GETIT_BASE_URL', 'GETIT_MODEL',
    'GETIT_TIMEOUT', 'GETIT_PROFILE', 'GETIT_DRY_RUN', 'OPENROUTER_API_KEY'
  ];
  const envBackup: Record<string, string | undefined> = {};
  for (const key of backupEnvKeys) {
    envBackup[key] = process.env[key];
    delete process.env[key];
  }

  const cleanTempFiles = () => {
    if (fs.existsSync(testEnvFile)) fs.unlinkSync(testEnvFile);
    if (fs.existsSync(testRcFile)) fs.unlinkSync(testRcFile);
    for (const key of backupEnvKeys) {
      delete process.env[key];
    }
  };

  const restoreEnv = () => {
    for (const key of backupEnvKeys) {
      if (envBackup[key] !== undefined) {
        process.env[key] = envBackup[key];
      } else {
        delete process.env[key];
      }
    }
  };

  await t.test('should fall back to openrouter default values when no config is set', () => {
    cleanTempFiles();
    const config = loadConfig();
    assert.strictEqual(config.carrier, 'openrouter');
    assert.strictEqual(config.baseUrl, 'https://openrouter.ai/api/v1');
    assert.strictEqual(config.model, 'nvidia/nemotron-3-super-120b-a12b:free');
    assert.strictEqual(config.timeout, 60000);
    assert.strictEqual(config.profile, 'normal');
    assert.strictEqual(config.dryRun, false);
  });

  await t.test('should parse environment keys with case-insensitivity from configuration files', () => {
    cleanTempFiles();
    fs.writeFileSync(testRcFile, 'carrier=openai\napi_key=sk-openai123456\ntimeout=35000\ndry_run=true', 'utf-8');

    const config = loadConfig();
    assert.strictEqual(config.carrier, 'openai');
    assert.strictEqual(config.apiKey, 'sk-openai123456');
    assert.strictEqual(config.timeout, 35000);
    assert.strictEqual(config.dryRun, true);
    assert.strictEqual(config.baseUrl, 'https://api.openai.com/v1'); // derived default for openai
    assert.strictEqual(config.model, 'gpt-4o'); // derived default for openai
  });

  await t.test('should respect process.env absolute priority override over local config files', () => {
    cleanTempFiles();
    fs.writeFileSync(testEnvFile, 'GETIT_CARRIER=custom\nGETIT_API_KEY=local-file-key', 'utf-8');
    
    // Set a process.env override
    process.env.GETIT_CARRIER = 'openai';
    process.env.GETIT_API_KEY = 'env-override-key';

    try {
      const config = loadConfig();
      assert.strictEqual(config.carrier, 'openai');
      assert.strictEqual(config.apiKey, 'env-override-key');
    } finally {
      delete process.env.GETIT_CARRIER;
      delete process.env.GETIT_API_KEY;
    }
  });

  await t.test('should preserve historic OPENROUTER_API_KEY fallback compatibility', () => {
    cleanTempFiles();
    fs.writeFileSync(testEnvFile, 'OPENROUTER_API_KEY=sk-historicalopenrouterkey', 'utf-8');

    const config = loadConfig();
    assert.strictEqual(config.apiKey, 'sk-historicalopenrouterkey');
    assert.strictEqual(config.carrier, 'openrouter');
  });

  await t.test('should strip optional single and double quotes from parsed values', () => {
    cleanTempFiles();
    fs.writeFileSync(testEnvFile, 'GETIT_CARRIER="openai"\nGETIT_API_KEY=\'sk-quotedkey\'\nGETIT_BASE_URL="http://test.url/"', 'utf-8');

    const config = loadConfig();
    assert.strictEqual(config.carrier, 'openai');
    assert.strictEqual(config.apiKey, 'sk-quotedkey');
    assert.strictEqual(config.baseUrl, 'http://test.url'); // trailing slash stripped too
  });

  // Final Cleanup
  cleanTempFiles();
  restoreEnv();
});

test('Universal Config Suite: Secrets Redaction Registry', async (t) => {
  await t.test('should dynamically mask custom registered key formats in logs', () => {
    const customKey = 'super-secret-unique-key-998877';
    registerKnownSecret(customKey);

    const logText = `Connecting to API endpoint with key=${customKey} for prompt payload.`;
    const scrubbed = scrubText(logText);

    assert.ok(!scrubbed.includes(customKey));
    assert.ok(scrubbed.includes('[REDACTED_'));
  });
});
