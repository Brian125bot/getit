import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { loadAllPlugins } from '../src/plugins/loader.js';

describe('Plugins Loader', () => {
  let workspaceRoot: string;
  let pluginDir: string;

  before(async () => {
    workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'getit-test-workspace-'));
    pluginDir = path.join(workspaceRoot, '.getit', 'tools');
    await fsp.mkdir(pluginDir, { recursive: true });
    
    // Write a dummy TS plugin
    const pluginCode = `
      export default {
        name: 'test_loader_plugin',
        description: 'Test plugin from loader',
        parameters: { type: 'object', properties: {} },
        risk: 'read',
        execute: async () => ({ output: 'loaded' })
      };
    `;
    await fsp.writeFile(path.join(pluginDir, 'test-plugin.ts'), pluginCode);
  });

  after(async () => {
    await fsp.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('PLG_001: should load plugins from workspace directory', async () => {
    const { plugins, result } = await loadAllPlugins(workspaceRoot);
    
    assert.ok(plugins.length > 0);
    const testPlugin = plugins.find(p => p.definition.name === 'test_loader_plugin');
    assert.ok(testPlugin);
    assert.equal(testPlugin.source, 'workspace');
  });

  it('PLG_002: should handle compilation failure gracefully', async () => {
    const badPluginCode = `
      import { nonExistent } from 'nowhere';
      export default { invalid_syntax;
    `;
    await fsp.writeFile(path.join(pluginDir, 'bad-plugin.ts'), badPluginCode);
    
    const { plugins, result } = await loadAllPlugins(workspaceRoot);
    assert.ok(result.skipped.some(s => s.file === 'bad-plugin.ts'));
    
    await fsp.unlink(path.join(pluginDir, 'bad-plugin.ts'));
  });

  it('PLG_003: should skip plugins that fail validation', async () => {
    const invalidPluginCode = `
      export default {
        name: 'test_loader_plugin_bad',
        // missing parameters and execute
      };
    `;
    await fsp.writeFile(path.join(pluginDir, 'invalid-plugin.ts'), invalidPluginCode);
    
    const { result } = await loadAllPlugins(workspaceRoot);
    assert.ok(result.skipped.some(s => s.file === 'invalid-plugin.ts'));
  });
});
