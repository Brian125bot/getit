import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { 
  registerCommand, 
  unregisterCommand, 
  searchPalette, 
  getByCategory, 
  getAllCommands, 
  registerBuiltinCommands, 
  renderPalette 
} from '../src/repl/control-plane/palette.js';

describe('REPL Palette', () => {
  beforeEach(() => {
    // Clear the registry by getting all and unregistering
    const all = getAllCommands();
    for (const cmd of all) {
      unregisterCommand(cmd.id);
    }
  });

  it('CTL_009: should register a command', () => {
    registerCommand({
      id: 'cmd1', label: '/cmd1', description: 'desc', category: 'system', keywords: [], action: '/cmd1'
    });
    const all = getAllCommands();
    assert.equal(all.length, 1);
    assert.equal(all[0].id, 'cmd1');
  });

  it('CTL_010: should overwrite on register with same ID', () => {
    registerCommand({
      id: 'cmd1', label: '/cmd1', description: 'old', category: 'system', keywords: [], action: '/cmd1'
    });
    registerCommand({
      id: 'cmd1', label: '/cmd1', description: 'new', category: 'system', keywords: [], action: '/cmd1'
    });
    const all = getAllCommands();
    assert.equal(all.length, 1);
    assert.equal(all[0].description, 'new');
  });

  it('CTL_011: should unregister a command', () => {
    registerCommand({
      id: 'cmd1', label: '/cmd1', description: 'desc', category: 'system', keywords: [], action: '/cmd1'
    });
    const result = unregisterCommand('cmd1');
    assert.equal(result, true);
    assert.equal(getAllCommands().length, 0);
  });

  it('CTL_012: should return false when unregistering non-existent', () => {
    const result = unregisterCommand('non-existent');
    assert.equal(result, false);
  });

  it('CTL_013: should fuzzy search the palette', () => {
    registerCommand({
      id: '1', label: '/build', description: 'Build project', category: 'system', keywords: ['compile'], action: '/build'
    });
    registerCommand({
      id: '2', label: '/test', description: 'Run tests', category: 'system', keywords: ['jest'], action: '/test'
    });

    const res1 = searchPalette('buil');
    assert.equal(res1.length, 1);
    assert.equal(res1[0].id, '1');

    const res2 = searchPalette('compile');
    assert.equal(res2.length, 1);
    assert.equal(res2[0].id, '1');

    const res3 = searchPalette('run');
    assert.equal(res3.length, 1);
    assert.equal(res3[0].id, '2');
  });

  it('CTL_014: should get commands by category', () => {
    registerCommand({
      id: '1', label: '/c1', description: 'desc', category: 'system', keywords: [], action: '/c1'
    });
    registerCommand({
      id: '2', label: '/c2', description: 'desc', category: 'workspace', keywords: [], action: '/c2'
    });
    const sys = getByCategory('system');
    assert.equal(sys.length, 1);
    assert.equal(sys[0].id, '1');
  });

  it('CTL_015: should register built-in commands', () => {
    registerBuiltinCommands();
    const all = getAllCommands();
    assert.ok(all.length > 10);
    assert.ok(all.some(c => c.label === '/help'));
    assert.ok(all.some(c => c.label === '/exit'));
  });

  it('CTL_016: should render palette ASCII output', () => {
    registerCommand({
      id: 'cmd1', label: '/cmd1', description: 'test description', category: 'system', keywords: [], action: '/cmd1'
    });
    const output = renderPalette(getAllCommands(), 'cmd');
    assert.ok(output.includes('COMMAND PALETTE'));
    assert.ok(output.includes('/cmd1'));
    assert.ok(output.includes('test description'));
  });
});
