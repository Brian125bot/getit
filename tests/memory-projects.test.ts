import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { 
  initProjectMemory, 
  loadProjectMemory, 
  buildProjectContext, 
  getCurrentProject, 
  detectTechStack, 
  saveProjectMemory 
} from '../src/memory/projects.js';

describe('Memory Projects', () => {
  let tmpDir: string;
  let fingerprint: string;

  before(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'getit-test-projects-'));
    await fsp.writeFile(path.join(tmpDir, 'package.json'), '{}');
  });

  after(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    const mem = await initProjectMemory(tmpDir);
    fingerprint = mem.fingerprint;
  });

  it('MEM_009: should initialize project memory with 1 argument', async () => {
    assert.ok(fingerprint.length > 0);
  });

  it('MEM_010: should load project memory from disk', async () => {
    const mem = await loadProjectMemory(fingerprint);
    assert.ok(mem);
    assert.ok(mem!.fingerprint === fingerprint);
  });

  it('MEM_011: should save and then load project memory', async () => {
    const mem = await loadProjectMemory(fingerprint);
    if (!mem) throw new Error('memory not found');
    mem.learnings.push({ id: '1', content: 'test note', category: 'general', timestamp: new Date().toISOString() });
    await saveProjectMemory(mem);
    
    const loaded = await loadProjectMemory(fingerprint);
    assert.ok(loaded!.learnings.some(l => l.content === 'test note'));
  });

  it('MEM_012: should build project context string', async () => {
    const mem = await loadProjectMemory(fingerprint);
    if (!mem) throw new Error('memory not found');
    mem.learnings.push({ id: '2', content: 'special context note', category: 'general', timestamp: new Date().toISOString() });
    await saveProjectMemory(mem);
    await initProjectMemory(tmpDir); // refresh singleton
    
    const ctx = buildProjectContext();
    assert.ok(ctx.includes('special context note'));
  });

  it('MEM_013: should get current project from singleton', async () => {
    const proj = getCurrentProject();
    assert.ok(proj);
    assert.equal(proj!.fingerprint, fingerprint);
  });

  it('MEM_014: should detect tech stack from package.json', async () => {
    const stack = await detectTechStack(tmpDir);
    assert.ok(stack.detected.includes('package.json'));
  });

  it('MEM_015: should initialize project memory with 3 arguments', async () => {
    const explicitFp = 'explicit-fp';
    const name = 'TestProject';
    const mem = await initProjectMemory(explicitFp, name, tmpDir);
    assert.equal(mem.fingerprint, explicitFp);
    
    const loaded = await loadProjectMemory(explicitFp);
    assert.equal(loaded!.projectName, name);
  });

  it('MEM_016: should detect tech stack python from pyproject.toml', async () => {
    const pyDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'getit-test-projects-py-'));
    await fsp.writeFile(path.join(pyDir, 'pyproject.toml'), '');
    const stack = await detectTechStack(pyDir);
    assert.ok(stack.language === 'python');
    await fsp.rm(pyDir, { recursive: true, force: true });
  });
});
