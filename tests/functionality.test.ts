import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

process.env.GETIT_TEST_MODE = 'true';

import { discoverEnvironment } from '../src/discovery/environment.js';
import { buildSystemPrompt } from '../src/agent/prompt.js';
import { loadApiKey } from '../src/security/secrets-loader.js';
import { generateDiffPreview } from '../src/tools/diff.js';
import { getActiveCwd, setActiveCwd } from '../src/tools/execute-bash.js';
import { manageFile } from '../src/tools/manage-file.js';

test('Functionality Test Suite: Environment Discovery', async (t) => {
  await t.test('should discover CPU architecture and map x64 to x86_64', () => {
    const env = discoverEnvironment();
    assert.ok(env.arch);
    const expected = os.arch() === 'x64' ? 'x86_64' : os.arch();
    assert.strictEqual(env.arch, expected);
  });

  await t.test('should accurately check standard host binary dependencies', () => {
    const env = discoverEnvironment();
    assert.strictEqual(typeof env.binaries['curl'], 'boolean');
    assert.strictEqual(typeof env.binaries['tar'], 'boolean');
    assert.strictEqual(typeof env.binaries['unzip'], 'boolean');
  });

  await t.test('should identify home directory context', () => {
    const env = discoverEnvironment();
    assert.strictEqual(env.homeDir, os.homedir());
  });
});

test('Functionality Test Suite: System Prompt Builder', () => {
  const prompt = buildSystemPrompt();
  
  assert.ok(prompt.includes('You are a local development and installation agent'));
  assert.ok(prompt.includes('CRITICAL INSTRUCTIONS'));
  assert.ok(prompt.includes('CPU Architecture'));
  assert.ok(prompt.includes('Network & Installation Dependencies'));
});

test('Functionality Test Suite: Secrets Loader fallback and parser', async (t) => {
  const cwd = process.cwd();
  const testEnvFile = path.join(cwd, '.env');
  const backupEnv = process.env.OPENROUTER_API_KEY;

  await t.test('should read from .env if present in current directory', () => {
    // Clean process.env to ensure we test file parsing
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GETIT_API_KEY;

    try {
      fs.writeFileSync(testEnvFile, 'OPENROUTER_API_KEY=test_file_loaded_key\nOTHER_KEY=value', 'utf-8');
      const loaded = loadApiKey();
      assert.strictEqual(loaded, 'test_file_loaded_key');
      assert.strictEqual(process.env.OPENROUTER_API_KEY, 'test_file_loaded_key');
    } finally {
      if (fs.existsSync(testEnvFile)) {
        fs.unlinkSync(testEnvFile);
      }
      if (backupEnv) {
        process.env.OPENROUTER_API_KEY = backupEnv;
      }
    }
  });

  await t.test('should return undefined if no environment/file is set', () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GETIT_API_KEY;
    const loaded = loadApiKey();
    assert.strictEqual(loaded, undefined);
    if (backupEnv) {
      process.env.OPENROUTER_API_KEY = backupEnv;
    }
  });
});

test('Functionality Test Suite: LCS Unified Diff Generator', async (t) => {
  await t.test('should calculate correct colored ANSI diff for single line replacement', () => {
    const orig = 'line1\nline2\nline3';
    const mod = 'line1\nlineX\nline3';
    const diff = generateDiffPreview(orig, mod);
    
    // Removals must contain red coloring syntax
    assert.ok(diff.includes('\x1b[31m- line2\x1b[0m'), 'Must contain red subtraction line');
    // Additions must contain green coloring syntax
    assert.ok(diff.includes('\x1b[32m+ lineX\x1b[0m'), 'Must contain green addition line');
    // Unchanged lines should remain unmodified
    assert.ok(diff.includes('  line1'), 'Must contain common context line');
    assert.ok(diff.includes('  line3'), 'Must contain common context line');
  });
});

test('Functionality Test Suite: Stateful CWD Tracker', async (t) => {
  const originalCwd = getActiveCwd();

  await t.test('should retrieve active Cwd tracking state', () => {
    assert.ok(path.isAbsolute(getActiveCwd()));
  });

  await t.test('should statefully alter active Cwd when directory exists', () => {
    const tempDir = os.tmpdir();
    setActiveCwd(tempDir);
    assert.strictEqual(getActiveCwd(), path.resolve(tempDir));
    // Restore
    setActiveCwd(originalCwd);
  });

  await t.test('should throw an error when target directory does not exist', () => {
    assert.throws(() => {
      setActiveCwd('/non-existent/directory/path/for/getit/test');
    });
  });
});

test('Functionality Test Suite: File Management', async (t) => {
  const testFilePath = path.join(os.tmpdir(), `getit-func-test-${Date.now()}.txt`);

  await t.test('should fail when reading non-existent file', async () => {
    const res = await manageFile('read', '/non-existent-getit-test-file.txt');
    assert.strictEqual(res.success, false);
    assert.ok(res.error?.includes('not found'));
  });

  await t.test('should read created files and display correct sizes and lines', async () => {
    const content = 'Hello World!\nLine Two\nThird Line';
    fs.writeFileSync(testFilePath, content, 'utf-8');

    try {
      const res = await manageFile('read', testFilePath);
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.content, content);
      assert.strictEqual(res.metadata?.lines, 3);
      assert.strictEqual(res.metadata?.size, Buffer.byteLength(content));
    } finally {
      if (fs.existsSync(testFilePath)) {
        fs.unlinkSync(testFilePath);
      }
    }
  });

  await t.test('should support file creation and deferred directory logic', async () => {
    const testSubdir = path.join(os.tmpdir(), `getit-subdir-${Date.now()}`);
    const testFile = path.join(testSubdir, 'hello.txt');

    try {
      const res = await manageFile('create', testFile, 'Hello Universe!');
      assert.strictEqual(res.success, true);
      assert.strictEqual(fs.readFileSync(testFile, 'utf-8'), 'Hello Universe!');
    } finally {
      try {
        if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
        if (fs.existsSync(testSubdir)) fs.rmdirSync(testSubdir);
      } catch {}
    }
  });
});

test('Functionality Test Suite: Bash Execution Bounds', async (t) => {
  const { executeBash, setDefaultTimeout } = await import('../src/tools/execute-bash.js');

  await t.test('should execute simple shell command successfully', async () => {
    const res = await executeBash('echo "getit_hello"');
    assert.strictEqual(res.exitCode, 0);
    assert.strictEqual(res.stdout.trim(), 'getit_hello');
  });

  await t.test('should trigger timeout limit on long running commands', async () => {
    const originalTimeout = 60000;
    // Set a very short timeout of 500ms for testing
    setDefaultTimeout(500);

    try {
      const res = await executeBash('sleep 10');
      assert.strictEqual(res.haltTurn, true, 'Turn must be halted on timeout');
      assert.ok(res.error?.includes('timed out') || res.stderr.includes('timeout') || res.error?.includes('ETIMEDOUT'));
    } finally {
      // Restore default timeout
      setDefaultTimeout(originalTimeout);
    }
  });

  await t.test('should catch syntax errors early and fail-closed before MITL interceptor', async () => {
    const res = await executeBash('echo "unclosed quote');
    assert.strictEqual(res.haltTurn, true);
    assert.ok(res.exitCode !== 0);
    assert.ok(res.error?.includes('validation error') || res.error?.includes('unexpected EOF') || res.stderr.includes('syntax error'));
  });
});
