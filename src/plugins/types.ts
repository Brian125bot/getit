/**
 * @module plugins/types
 * @description Type definitions for the getit v2.0 Plugin Tool Registry.
 *
 * Every user-authored plugin must export a default object conforming to
 * {@link PluginToolDefinition}. Plugins are loaded from `.getit/tools/`
 * (workspace-local) or `~/.config/getit/tools/` (global).
 */

/**
 * Risk classification for plugin MITL behavior.
 * - 'read'   — Auto-approved. Output is scrubbed before LLM context.
 * - 'write'  — Standard [Y/n/e/c] MITL gate.
 * - 'system' — Enhanced MITL gate with red warning. Cannot be auto-trusted.
 */
export type PluginRiskLevel = 'read' | 'write' | 'system';

/**
 * JSON Schema subset for parameter definitions.
 * Uses the same shape as OpenAI function calling parameter schemas.
 */
export interface PluginParameterSchema {
  type: 'object';
  properties: Record<string, {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    description: string;
    enum?: string[];
    items?: { type: string };
    default?: unknown;
  }>;
  required?: string[];
}

/**
 * The result shape returned by every plugin execution.
 */
export interface PluginExecutionResult {
  /** Serializable output sent to the LLM as tool response content. */
  output: unknown;
  /** If true, halts the agent turn (fail-closed behavior). */
  halt?: boolean;
  /** Optional clarification request routed back to the user. */
  clarify?: string;
}

/**
 * The contract every plugin tool must satisfy.
 */
export interface PluginToolDefinition {
  /** Unique tool name. Must match /^[a-z][a-z0-9_]{1,63}$/ */
  name: string;
  /** Human-readable description injected into the LLM tool schema. Max 500 chars. */
  description: string;
  /** JSON Schema for the tool's parameters. */
  parameters: PluginParameterSchema;
  /** Risk level determining MITL gate behavior. */
  risk: PluginRiskLevel;
  /** The execution function. Receives validated args, returns structured result. */
  execute: (args: Record<string, unknown>) => Promise<PluginExecutionResult>;
  /**
   * Optional MITL display formatter.
   * If provided, generates the human-readable string shown in the MITL approval card.
   * If omitted, a default JSON.stringify of args is shown.
   */
  formatApprovalCard?: (args: Record<string, unknown>) => string;
  /**
   * Optional validation function run before MITL gate.
   * Throw an Error to reject the call before it reaches the user.
   */
  validate?: (args: Record<string, unknown>) => void | Promise<void>;
}
