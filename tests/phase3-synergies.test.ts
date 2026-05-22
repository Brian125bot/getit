import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

process.env.GETIT_TEST_MODE = 'true';

import { executeBash } from '../src/tools/execute-bash.js';
import { scrubText, MaskingSession } from '../src/security/scrubber.js';
import { findWorkspaceRoot } from '../src/workspace/boundary.js';
import { generateDiffPreview } from '../src/tools/diff.js';

test('Synergy A: Failed commands without healer match append diagnostic advice', async () => {
  const result = await executeBash('false'); // false command exits with 1
  assert.ok(result.error);
  assert.ok(result.error.includes('[Healer Note: This error did not match any automated healing rules. Please review the stderr logs to identify if a system dependency or config is missing and run a corrective command.]'));
});

test('Synergy C: Environmental dashboard warning logic resolves anchors correctly', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getit-sync-warning-'));
  try {
    // 1. Initially, no manifest and no anchors
    let root = findWorkspaceRoot(tempDir);
    assert.strictEqual(root, null);
    
    const anchors = ['package.json', 'Cargo.toml', 'pyproject.toml', 'go.mod', '.git'];
    let hasAnchors = anchors.some(anchor => fs.existsSync(path.join(tempDir, anchor)));
    assert.strictEqual(hasAnchors, false);

    // 2. Add an anchor
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{}', 'utf-8');
    
    // Still no manifest root
    root = findWorkspaceRoot(tempDir);
    assert.strictEqual(root, null);
    
    // But anchors exist!
    hasAnchors = anchors.some(anchor => fs.existsSync(path.join(tempDir, anchor)));
    assert.strictEqual(hasAnchors, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Synergy D: Secret detection on commands', () => {
  const secretCommand = 'echo "sk-proj-12345678901234567890"';
  const scanSession = new MaskingSession();
  const commandScrubbed = scrubText(secretCommand, scanSession);
  assert.notStrictEqual(commandScrubbed, secretCommand);
  assert.ok(commandScrubbed.includes('[REDACTED_'));
});

test('Synergy D: Secret detection on file content', () => {
  const secretContent = 'API_KEY=sk-testsecretkey1234567890123456789\n';
  const scanSession = new MaskingSession();
  const scrubbed = scrubText(secretContent, scanSession);
  assert.notStrictEqual(scrubbed, secretContent);
  assert.ok(scrubbed.includes('[REDACTED_'));
});

test('Synergy B: generateDiffPreview formats unified diff cleanly', () => {
  const original = 'line1\nline2\nline3';
  const modified = 'line1\nline2changed\nline3';
  const diff = generateDiffPreview(original, modified);
  assert.ok(diff.includes('line1'));
  assert.ok(diff.includes('line2'));
  assert.ok(diff.includes('line3'));
});
