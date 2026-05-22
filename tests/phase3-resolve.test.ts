import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { initWorkspaceManifest } from '../src/workspace/manifest.js';
import { detectWorkspaceDrift } from '../src/workspace/drift.js';
import { runWorkspaceResolve } from '../src/index.js';
import { setReadlineInterface } from '../src/mitl/interceptor.js';
import { setChatRequestMock } from '../src/agent/client.js';

test('Phase 3 Resolve: Interactively resolve drift by mocking readline and chat', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getit-resolve-'));
  try {
    // 1. Setup workspace
    const filePath = path.join(tempDir, 'package.json');
    fs.writeFileSync(filePath, '{"v":1}', 'utf-8');
    await initWorkspaceManifest(tempDir);

    // 2. Introduce drift
    fs.writeFileSync(filePath, '{"v":2}', 'utf-8');
    let drift = await detectWorkspaceDrift(tempDir);
    assert.strictEqual(drift.hasDrift, true);

    // 3. Mock dependencies
    setChatRequestMock(async () => ({
      content: '• Looks safe',
      toolCalls: []
    }));

    let questionsAsked = 0;
    const mockRl = {
      question: async (prompt: string) => {
        questionsAsked++;
        return 'y';
      },
      close: () => {}
    } as any;
    setReadlineInterface(mockRl);

    // 4. Run resolve
    // Since runWorkspaceResolve uses console.log, we can just let it log or mock it if we wanted to suppress.
    const origLog = console.log;
    console.log = () => {}; // suppress noise during test
    try {
      await runWorkspaceResolve(tempDir);
    } finally {
      console.log = origLog;
    }

    // 5. Verify resolution
    assert.strictEqual(questionsAsked, 1, 'Should have asked exactly one question');
    drift = await detectWorkspaceDrift(tempDir);
    assert.strictEqual(drift.hasDrift, false, 'Drift should be resolved');

  } finally {
    setChatRequestMock(null as any);
    setReadlineInterface(null);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
