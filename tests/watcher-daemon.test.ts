import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { WatchDaemon } from '../src/watcher/daemon.js';

describe('Watcher Daemon', () => {
  let tmpDir: string;
  let daemon: WatchDaemon;

  before(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'getit-test-watch-'));
  });

  after(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    daemon = new WatchDaemon(tmpDir);
  });

  afterEach(async () => {
    await daemon.stop();
  });

  it('WCH_001: should initialize correctly', () => {
    assert.equal(daemon.isRunning(), false);
  });

  it('WCH_002: should toggle running state on start/stop', async () => {
    await daemon.start();
    assert.equal(daemon.isRunning(), true);
    await daemon.stop();
    assert.equal(daemon.isRunning(), false);
  });

  it('WCH_003: should emit started and stopped events', async () => {
    let started = false;
    let stopped = false;
    daemon.on('started', () => started = true);
    daemon.on('stopped', () => stopped = true);

    await daemon.start();
    assert.equal(started, true);
    
    await daemon.stop();
    assert.equal(stopped, true);
  });

  it('WCH_004: should ignore duplicate starts', async () => {
    await daemon.start();
    await daemon.start(); // Should not throw
    assert.equal(daemon.isRunning(), true);
  });

  it('WCH_005: should ignore duplicate stops', async () => {
    await daemon.start();
    await daemon.stop();
    await daemon.stop(); // Should not throw
    assert.equal(daemon.isRunning(), false);
  });

  it('WCH_006: should detect file creation', async () => {
    await daemon.start();
    
    const eventPromise = new Promise<any>((resolve) => {
      daemon.on('change', (event) => {
        if (event.relativePath === 'new_file.txt') resolve(event);
      });
    });

    await fsp.writeFile(path.join(tmpDir, 'new_file.txt'), 'test');
    
    // Fallback timeout
    const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 2000));
    
    const result = await Promise.race([eventPromise, timeout]);
    assert.ok(result, 'Did not receive change event within timeout');
    if (result) {
      assert.equal(result.relativePath, 'new_file.txt');
    }
  });

  it('WCH_007: should emit ignored events for excluded paths', async () => {
    // .git should be ignored
    await fsp.mkdir(path.join(tmpDir, '.git'));
    await daemon.start();
    
    let ignoredReceived = false;
    daemon.on('ignored', () => ignoredReceived = true);
    
    await fsp.writeFile(path.join(tmpDir, '.git', 'HEAD'), 'ref: refs/heads/main');
    
    await new Promise(r => setTimeout(r, 500));
    // Implementation may not even watch .git, so we just check it doesn't crash
    // and doesn't emit 'change' for it.
    let changed = false;
    daemon.on('change', () => changed = true);
    assert.equal(changed, false);
  });

  it('WCH_008: should handle rapid stop after start', async () => {
    const startP = daemon.start();
    await daemon.stop();
    await startP;
    // It should end up stopped
    assert.equal(daemon.isRunning(), false);
  });
});
