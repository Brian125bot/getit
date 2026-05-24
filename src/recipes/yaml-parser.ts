/**
 * @module recipes/yaml-parser
 * @description Zero-dependency YAML parser for recipe files.
 *
 * Handles the subset of YAML used in getit recipes: mappings, sequences,
 * scalar values (strings, numbers, booleans), and multi-line strings.
 * Does not support anchors, aliases, or complex YAML features.
 */
import type { Recipe, RecipeStep, RecipeParameter } from './types.js';

interface YamlNode {
  [key: string]: unknown;
}

/**
 * Parse a simple YAML string into a JavaScript object.
 * Handles indentation-based nesting, arrays (- item), and scalars.
 */
export function parseSimpleYaml(input: string): YamlNode {
  const lines = input.split('\n');
  const result: YamlNode = {};
  const stack: Array<{ indent: number; obj: any; key?: string }> = [{ indent: -1, obj: result }];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.search(/\S/);

    // Pop stack to matching indent level
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parent = stack[stack.length - 1].obj;

    // Array item
    if (trimmed.startsWith('- ')) {
      const value = trimmed.slice(2).trim();
      const parentKey = stack[stack.length - 1].key;
      if (parentKey && Array.isArray(parent[parentKey])) {
        if (value.includes(':')) {
          const obj: YamlNode = {};
          parseInlineMapping(value, obj);
          parent[parentKey].push(obj);
          stack.push({ indent, obj, key: undefined });
        } else {
          parent[parentKey].push(parseScalar(value));
        }
      } else if (Array.isArray(parent)) {
        if (value.includes(':') && !value.startsWith('"') && !value.startsWith("'")) {
          const obj: YamlNode = {};
          parseInlineMapping(value, obj);
          parent.push(obj);
          stack.push({ indent, obj, key: undefined });
        } else {
          parent.push(parseScalar(value));
        }
      }
      continue;
    }

    // Key-value pair
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim();
      const value = trimmed.slice(colonIdx + 1).trim();

      if (!value) {
        // Nested object or array — look ahead to determine
        const nextLine = lines[i + 1]?.trim();
        if (nextLine?.startsWith('- ')) {
          parent[key] = [];
          stack.push({ indent, obj: parent, key });
        } else {
          parent[key] = {};
          stack.push({ indent, obj: parent[key], key: undefined });
        }
      } else {
        parent[key] = parseScalar(value);
      }
    }
  }

  return result;
}

function parseInlineMapping(input: string, target: YamlNode): void {
  const pairs = input.split(/,\s*/);
  for (const pair of pairs) {
    const colonIdx = pair.indexOf(':');
    if (colonIdx > 0) {
      const key = pair.slice(0, colonIdx).trim();
      const value = pair.slice(colonIdx + 1).trim();
      target[key] = parseScalar(value);
    }
  }
}

function parseScalar(value: string): string | number | boolean | null {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;

  // Quoted strings
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  // Numbers
  const num = Number(value);
  if (!isNaN(num) && value !== '') return num;

  return value;
}

/**
 * Parse a YAML recipe file into a Recipe object.
 */
export function parseRecipeYaml(yamlContent: string): Recipe {
  const parsed = parseSimpleYaml(yamlContent);

  const parameters: RecipeParameter[] = [];
  if (Array.isArray(parsed.parameters)) {
    for (const p of parsed.parameters) {
      if (typeof p === 'object' && p !== null) {
        parameters.push({
          name: String((p as any).name || ''),
          description: String((p as any).description || ''),
          type: ((p as any).type || 'string') as RecipeParameter['type'],
          default: (p as any).default,
          required: (p as any).required !== false
        });
      }
    }
  }

  const steps: RecipeStep[] = [];
  if (Array.isArray(parsed.steps)) {
    for (let i = 0; i < parsed.steps.length; i++) {
      const s = parsed.steps[i] as any;
      if (typeof s === 'object' && s !== null) {
        steps.push({
          id: String(s.id || `step_${i + 1}`),
          description: String(s.description || ''),
          tool: String(s.tool || ''),
          args: (typeof s.args === 'object' ? s.args : {}) as Record<string, unknown>,
          failFast: s.failFast !== false,
          condition: s.condition ? String(s.condition) : undefined,
          capture: s.capture ? String(s.capture) : undefined,
          retries: typeof s.retries === 'number' ? s.retries : 0
        });
      }
    }
  }

  return {
    name: String(parsed.name || 'unnamed'),
    description: String(parsed.description || ''),
    version: String(parsed.version || '1.0.0'),
    author: parsed.author ? String(parsed.author) : undefined,
    parameters,
    steps,
    tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : undefined,
    trusted: parsed.trusted === true
  };
}

/**
 * Serialize a Recipe to YAML format.
 */
export function serializeRecipeYaml(recipe: Recipe): string {
  const lines: string[] = [];

  lines.push(`name: ${recipe.name}`);
  lines.push(`description: "${recipe.description}"`);
  lines.push(`version: ${recipe.version}`);
  if (recipe.author) lines.push(`author: ${recipe.author}`);
  if (recipe.trusted) lines.push(`trusted: true`);

  if (recipe.tags && recipe.tags.length > 0) {
    lines.push('tags:');
    for (const tag of recipe.tags) lines.push(`  - ${tag}`);
  }

  if (recipe.parameters.length > 0) {
    lines.push('parameters:');
    for (const p of recipe.parameters) {
      lines.push(`  - name: ${p.name}`);
      lines.push(`    description: "${p.description}"`);
      lines.push(`    type: ${p.type}`);
      lines.push(`    required: ${p.required}`);
      if (p.default !== undefined) lines.push(`    default: ${JSON.stringify(p.default)}`);
    }
  }

  lines.push('steps:');
  for (const step of recipe.steps) {
    lines.push(`  - id: ${step.id}`);
    lines.push(`    description: "${step.description}"`);
    lines.push(`    tool: ${step.tool}`);
    lines.push(`    args:`);
    for (const [key, val] of Object.entries(step.args)) {
      lines.push(`      ${key}: ${JSON.stringify(val)}`);
    }
    if (step.failFast === false) lines.push(`    failFast: false`);
    if (step.condition) lines.push(`    condition: "${step.condition}"`);
    if (step.capture) lines.push(`    capture: ${step.capture}`);
    if (step.retries && step.retries > 0) lines.push(`    retries: ${step.retries}`);
  }

  return lines.join('\n') + '\n';
}
