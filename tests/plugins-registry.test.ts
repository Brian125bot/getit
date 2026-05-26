import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { 
  initPluginRegistry, 
  getPlugin, 
  getAllPlugins, 
  executePlugin, 
  isPluginTool,
  reloadPlugins 
} from '../src/plugins/registry.js';
import * as os from 'node:os';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

describe('Plugins Registry', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'getit-test-registry-'));
    const pluginDir = path.join(workspaceRoot, '.getit', 'tools');
    await fsp.mkdir(pluginDir, { recursive: true });
    
    const pluginCode = `
      export default {
        name: 'test_registry_tool',
        description: 'Test plugin from registry',
        parameters: { type: 'object', properties: {} },
        risk: 'read',
        execute: async () => ({ output: 'ok from registry' })
      };
    `;
    await fsp.writeFile(path.join(pluginDir, 'test-plugin.ts'), pluginCode);
  });

  it('PLG_004: should initialize plugin registry and load plugins', async () => {
    await initPluginRegistry(workspaceRoot);
    const plugins = getAllPlugins();
    assert.ok(plugins.length > 0);
    assert.ok(plugins.some(p => p.name === 'test_registry_tool'));
  });

  it('PLG_005: should get plugin by name', async () => {
    await initPluginRegistry(workspaceRoot);
    const plugin = getPlugin('test_registry_tool');
    assert.ok(plugin);
    assert.equal(plugin.name, 'test_registry_tool');
  });

  it('PLG_006: should check if tool is plugin tool', async () => {
    await initPluginRegistry(workspaceRoot);
    assert.equal(isPluginTool('test_registry_tool'), true);
    assert.equal(isPluginTool('nonexistent_tool'), false);
  });

  it('PLG_007: should execute plugin', async () => {
    await initPluginRegistry(workspaceRoot);
    const result = await executePlugin('test_registry_tool', {});
    assert.equal((result.output as any), 'ok from registry');
    assert.equal(result.halt, undefined); // Should not halt turn by default
  });

  it('PLG_008: should handle execution error gracefully', async () => {
    const errorPluginCode = `
      export default {
        name: 'test_error_tool',
        description: 'Test error',
        parameters: { type: 'object', properties: {} },
        risk: 'read',
        execute: async () => { throw new Error('Test Error'); }
      };
    `;
    const pluginDir = path.join(workspaceRoot, '.getit', 'tools');
    await fsp.writeFile(path.join(pluginDir, 'error-plugin.ts'), errorPluginCode);
    
    await reloadPlugins(workspaceRoot);
    const result = await executePlugin('test_error_tool', {});
    assert.ok((result.output as any).error.includes('Test Error'));
    assert.equal(result.halt, true);
  });
});
