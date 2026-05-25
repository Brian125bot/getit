/**
 * @module plugins/validator
 * @description Schema and name validation for plugin tool definitions.
 */
import type { PluginToolDefinition } from './types.js';

/** Built-in tool names that plugins cannot shadow. */
const BUILTIN_TOOL_NAMES = new Set(['execute_bash', 'manage_file']);

/** Allowed plugin name pattern. */
const NAME_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates a plugin tool definition for correctness.
 * Returns a result with any validation errors found.
 */
export function validatePluginDefinition(
  definition: unknown,
  existingNames: Set<string>
): ValidationResult {
  const errors: string[] = [];

  if (!definition || typeof definition !== 'object') {
    return { valid: false, errors: ['Plugin must export a default object.'] };
  }

  const def = definition as Record<string, unknown>;

  // Name validation
  if (typeof def.name !== 'string') {
    errors.push('Plugin must have a "name" string property.');
  } else {
    if (!NAME_PATTERN.test(def.name)) {
      errors.push(`Plugin name "${def.name}" must match /^[a-z][a-z0-9_]{1,63}$/.`);
    }
    if (BUILTIN_TOOL_NAMES.has(def.name)) {
      errors.push(`Plugin name "${def.name}" collides with a built-in tool.`);
    }
    if (existingNames.has(def.name)) {
      errors.push(`Plugin name "${def.name}" collides with an already-loaded plugin.`);
    }
  }

  // Description validation
  if (typeof def.description !== 'string') {
    errors.push('Plugin must have a "description" string property.');
  } else if (def.description.length > 500) {
    errors.push(`Plugin description exceeds 500 characters (${def.description.length}).`);
  }

  // Parameters validation
  if (!def.parameters || typeof def.parameters !== 'object') {
    errors.push('Plugin must have a "parameters" object property.');
  } else {
    const params = def.parameters as Record<string, unknown>;
    if (params.type !== 'object') {
      errors.push('Plugin parameters.type must be "object".');
    }
  }

  // Risk validation
  if (!['read', 'write', 'system'].includes(def.risk as string)) {
    errors.push('Plugin risk must be one of: "read", "write", "system".');
  }

  // Execute function validation
  if (typeof def.execute !== 'function') {
    errors.push('Plugin must have an "execute" function.');
  }

  return { valid: errors.length === 0, errors };
}
