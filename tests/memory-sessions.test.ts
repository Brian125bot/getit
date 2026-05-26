import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { 
  initSessionMemory, 
  appendSessionEntry, 
  loadSessionEntries, 
  buildSessionContext, 
  clearSessionEntries, 
  recordToolCall 
} from '../src/memory/sessions.js';

describe('Memory Sessions', () => {
  let tmpDir: string;
  let fingerprint: string;

  before(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'getit-test-sessions-'));
  });

  after(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    fingerprint = crypto.createHash('sha256').update(tmpDir).digest('hex').slice(0, 16);
    await initSessionMemory(tmpDir);
  });

  afterEach(async () => {
    await clearSessionEntries(fingerprint);
  });

  it('MEM_001: should initialize session memory', async () => {
    const entries = await loadSessionEntries(fingerprint);
    assert.equal(entries.length, 0);
  });

  it('MEM_002: should append session entries correctly', async () => {
    await appendSessionEntry(fingerprint, {
      userPrompt: 'test user message',
      assistantSummary: 'response',
      toolsUsed: [],
      workingDirectory: tmpDir
    });
    const entries = await loadSessionEntries(fingerprint);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].userPrompt, 'test user message');
  });

  it('MEM_003: should load multiple session entries in order', async () => {
    await appendSessionEntry(fingerprint, { userPrompt: 'msg1', assistantSummary: '1', toolsUsed: [], workingDirectory: tmpDir });
    await appendSessionEntry(fingerprint, { userPrompt: 'msg2', assistantSummary: '2', toolsUsed: [], workingDirectory: tmpDir });
    
    const entries = await loadSessionEntries(fingerprint);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].userPrompt, 'msg1');
    assert.equal(entries[1].userPrompt, 'msg2');
  });

  it('MEM_004: should build session context string', async () => {
    await appendSessionEntry(fingerprint, { userPrompt: 'hello prompt', assistantSummary: 'hi there', toolsUsed: [], workingDirectory: tmpDir });
    await initSessionMemory(tmpDir); // refresh singleton
    const ctx = buildSessionContext();
    assert.ok(ctx.includes('hello prompt'));
    assert.ok(ctx.includes('hi there'));
  });

  it('MEM_005: should clear session entries', async () => {
    await appendSessionEntry(fingerprint, { userPrompt: 'test', assistantSummary: '', toolsUsed: [], workingDirectory: tmpDir });
    await clearSessionEntries(fingerprint);
    const entries = await loadSessionEntries(fingerprint);
    assert.equal(entries.length, 0);
  });

  it('MEM_006: should record tool calls successfully', async () => {
    await recordToolCall('my_tool', true);
    const ctx = buildSessionContext();
    assert.ok(ctx.includes('my_tool'));
    assert.ok(ctx.includes('succeeded'));
  });

  it('MEM_007: should record failed tool calls', async () => {
    await recordToolCall('fail_tool', false);
    const ctx = buildSessionContext();
    assert.ok(ctx.includes('fail_tool'));
    assert.ok(ctx.includes('failed'));
  });

  it('MEM_008: should handle loading non-existent sessions gracefully', async () => {
    const entries = await loadSessionEntries('non-existent-fingerprint');
    assert.deepEqual(entries, []);
  });
});
