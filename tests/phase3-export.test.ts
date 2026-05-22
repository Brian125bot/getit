import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initWorkspaceManifest } from '../src/workspace/manifest.js';
import { exportScrubbedWorkspace } from '../src/workspace/export.js';

test('Phase 3 Export: scrubbed bulk export contains no raw secrets', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getit-export-'));
  const outDir = path.join(tempDir, 'export-out');

  try {
    fs.writeFileSync(
      path.join(tempDir, '.env'),
      'API_KEY=sk-testsecretkey1234567890123456789\n',
      'utf-8'
    );

    await initWorkspaceManifest(tempDir);
    const result = await exportScrubbedWorkspace(tempDir, outDir);

    assert.ok(result.filesExported.includes('.env'));
    const exported = fs.readFileSync(path.join(outDir, '.env'), 'utf-8');
    assert.ok(exported.includes('[REDACTED'));
    assert.ok(!exported.includes('sk-testsecretkey1234567890123456789'));

    const meta = JSON.parse(fs.readFileSync(path.join(outDir, 'export-manifest.json'), 'utf-8'));
    assert.strictEqual(meta.fileCount, result.filesExported.length);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
