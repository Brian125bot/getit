/**
 * @module plugins/registry
 * @description Central plugin registry managing loaded plugins and their lifecycle.
 *
 * Provides plugin lookup, schema generation for LLM tool calling,
 * execution dispatch, and hot-reload capability.
 */
import type { PluginToolDefinition, PluginExecutionResult } from './types.js';
import type { LoadedPlugin } from './loader.js';
import { loadAllPlugins } from './loader.js';

/** Singleton registry of all loaded plugins. */
const pluginMap = new Map<string, LoadedPlugin>();

/** Event listeners for registry changes. */
const listeners: Array<(event: 'load' | 'unload' | 'reload', name: string) => void> = [];

/**
 * Initialize the plugin registry by loading all plugins from disk.
 */
export async function initPluginRegistry(workspaceRoot: string | null): Promise<{
  loaded: string[];
  skipped: Array<{ file: string; reason: string }>;
}> {
  pluginMap.clear();
  const { plugins, result } = await loadAllPlugins(workspaceRoot);

  for (const plugin of plugins) {
    pluginMap.set(plugin.definition.name, plugin);
    emitEvent('load', plugin.definition.name);
  }

  return result;
}

/**
 * Hot-reload all plugins (e.g. when watch mode detects changes in .getit/tools/).
 */
export async function reloadPlugins(workspaceRoot: string | null): Promise<{
  loaded: string[];
  skipped: Array<{ file: string; reason: string }>;
}> {
  const oldNames = new Set(pluginMap.keys());
  pluginMap.clear();

  const { plugins, result } = await loadAllPlugins(workspaceRoot);

  for (const plugin of plugins) {
    pluginMap.set(plugin.definition.name, plugin);
    emitEvent('reload', plugin.definition.name);
  }

  // Emit unload for plugins that were removed
  for (const name of oldNames) {
    if (!pluginMap.has(name)) {
      emitEvent('unload', name);
    }
  }

  return result;
}

/**
 * Returns true if a tool name is a registered plugin.
 */
export function isPluginTool(name: string): boolean {
  return pluginMap.has(name);
}

/**
 * Get a plugin definition by name.
 */
export function getPlugin(name: string): PluginToolDefinition | undefined {
  return pluginMap.get(name)?.definition;
}

/**
 * Get all loaded plugin definitions.
 */
export function getAllPlugins(): PluginToolDefinition[] {
  return Array.from(pluginMap.values()).map(p => p.definition);
}

/**
 * Generate OpenAI-compatible tool schemas for all loaded plugins.
 * These are merged with built-in tool schemas before sending to the LLM.
 */
export function getPluginToolSchemas(): Array<{
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}> {
  return Array.from(pluginMap.values()).map(p => ({
    type: 'function' as const,
    function: {
      name: p.definition.name,
      description: p.definition.description,
      parameters: p.definition.parameters
    }
  }));
}

/**
 * Execute a plugin tool call.
 * Runs the plugin's validate() if present, then execute().
 */
export async function executePlugin(
  name: string,
  args: Record<string, unknown>
): Promise<PluginExecutionResult> {
  const plugin = pluginMap.get(name);
  if (!plugin) {
    return { output: { error: `Plugin "${name}" not found.` }, halt: true };
  }

  const def = plugin.definition;

  // Run validation if provided
  if (def.validate) {
    try {
      await def.validate(args);
    } catch (err: any) {
      return {
        output: { error: `Validation failed: ${err.message}` },
        halt: false
      };
    }
  }

  // Execute the plugin
  try {
    return await def.execute(args);
  } catch (err: any) {
    return {
      output: { error: `Plugin execution error: ${err.message}` },
      halt: true
    };
  }
}

/**
 * Get MITL approval card text for a plugin call.
 */
export function formatPluginApprovalCard(
  name: string,
  args: Record<string, unknown>
): string {
  const plugin = pluginMap.get(name);
  if (!plugin) return JSON.stringify(args, null, 2);

  if (plugin.definition.formatApprovalCard) {
    try {
      return plugin.definition.formatApprovalCard(args);
    } catch {
      return JSON.stringify(args, null, 2);
    }
  }

  return JSON.stringify(args, null, 2);
}

/**
 * Subscribe to registry lifecycle events.
 */
export function onPluginEvent(
  listener: (event: 'load' | 'unload' | 'reload', name: string) => void
): () => void {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

function emitEvent(event: 'load' | 'unload' | 'reload', name: string): void {
  for (const listener of listeners) {
    try { listener(event, name); } catch { /* swallow listener errors */ }
  }
}
