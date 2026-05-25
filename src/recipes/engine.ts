/**
 * @module recipes/engine
 * @description Recipe execution engine for getit v2.0.
 *
 * Loads recipes from YAML files, resolves template parameters, and executes
 * each step sequentially through the standard tool dispatch pipeline.
 * Steps go through MITL approval unless the recipe is marked as trusted.
 */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Recipe, RecipeStep, StepResult, RecipeExecutionResult, RecipeParameter } from './types.js';
import { parseRecipeYaml } from './yaml-parser.js';
import { dispatchToolCall } from '../tools/registry.js';

/**
 * Discover recipe files from workspace and global directories.
 */
export async function discoverRecipes(workspaceRoot: string | null): Promise<Array<{
  name: string;
  source: 'workspace' | 'global';
  filePath: string;
}>> {
  const recipes: Array<{ name: string; source: 'workspace' | 'global'; filePath: string }> = [];

  // Workspace recipes
  if (workspaceRoot) {
    const wsRecipesDir = path.join(workspaceRoot, '.getit', 'recipes');
    try {
      const entries = await fsp.readdir(wsRecipesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
          recipes.push({
            name: entry.name.replace(/\.(yaml|yml)$/, ''),
            source: 'workspace',
            filePath: path.join(wsRecipesDir, entry.name)
          });
        }
      }
    } catch { /* directory may not exist */ }
  }

  // Global recipes
  const globalRecipesDir = path.join(os.homedir(), '.config', 'getit', 'recipes');
  try {
    const entries = await fsp.readdir(globalRecipesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
        const name = entry.name.replace(/\.(yaml|yml)$/, '');
        // Don't add if workspace recipe with same name exists
        if (!recipes.some(r => r.name === name)) {
          recipes.push({
            name,
            source: 'global',
            filePath: path.join(globalRecipesDir, entry.name)
          });
        }
      }
    }
  } catch { /* directory may not exist */ }

  return recipes;
}

/**
 * Load and parse a recipe from a YAML file.
 */
export async function loadRecipe(filePath: string): Promise<Recipe> {
  const content = await fsp.readFile(filePath, 'utf-8');
  return parseRecipeYaml(content);
}

/**
 * Resolve template parameters in a recipe step's args.
 * Replaces `{{paramName}}` with actual values.
 */
function resolveTemplateArgs(
  args: Record<string, unknown>,
  params: Record<string, unknown>
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      let result = value;
      for (const [paramName, paramValue] of Object.entries(params)) {
        result = result.replace(new RegExp(`\\{\\{${paramName}\\}\\}`, 'g'), String(paramValue));
      }
      // Resolve built-in template vars
      result = result.replace(/\{\{home\}\}/g, os.homedir());
      result = result.replace(/\{\{cwd\}\}/g, process.cwd());
      result = result.replace(/\{\{timestamp\}\}/g, new Date().toISOString());
      resolved[key] = result;
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}

/**
 * Validate and collect parameter values for a recipe.
 */
export function validateParameters(
  recipe: Recipe,
  provided: Record<string, unknown>
): { valid: boolean; errors: string[]; resolved: Record<string, unknown> } {
  const errors: string[] = [];
  const resolved: Record<string, unknown> = {};

  for (const param of recipe.parameters) {
    if (param.name in provided) {
      resolved[param.name] = provided[param.name];
    } else if (param.default !== undefined) {
      resolved[param.name] = param.default;
    } else if (param.required) {
      errors.push(`Required parameter "${param.name}" is missing.`);
    }
  }

  return { valid: errors.length === 0, errors, resolved };
}

/**
 * Evaluate a simple condition expression against captured values.
 * Supports: `var == "value"`, `var != "value"`, `var`, `!var`
 */
function evaluateCondition(condition: string, captured: Record<string, unknown>): boolean {
  const trimmed = condition.trim();

  // Negation: !varName
  if (trimmed.startsWith('!')) {
    const varName = trimmed.slice(1).trim();
    return !captured[varName];
  }

  // Equality check: var == "value"
  const eqMatch = trimmed.match(/^(\w+)\s*==\s*"([^"]*)"$/);
  if (eqMatch) {
    return String(captured[eqMatch[1]] || '') === eqMatch[2];
  }

  // Inequality check: var != "value"
  const neqMatch = trimmed.match(/^(\w+)\s*!=\s*"([^"]*)"$/);
  if (neqMatch) {
    return String(captured[neqMatch[1]] || '') !== neqMatch[2];
  }

  // Truthy check: just variable name
  return !!captured[trimmed];
}

/**
 * Execute a complete recipe.
 */
export async function executeRecipe(
  recipe: Recipe,
  paramValues: Record<string, unknown>,
  options: {
    onStepStart?: (step: RecipeStep, index: number) => void;
    onStepComplete?: (step: RecipeStep, result: StepResult) => void;
    abortSignal?: AbortSignal;
  } = {}
): Promise<RecipeExecutionResult> {
  const startTime = Date.now();
  const results: StepResult[] = [];
  const capturedValues: Record<string, unknown> = {};

  const { valid, errors, resolved } = validateParameters(recipe, paramValues);
  if (!valid) {
    return {
      recipeName: recipe.name,
      success: false,
      stepsCompleted: 0,
      totalSteps: recipe.steps.length,
      results: [],
      totalDurationMs: 0,
      capturedValues: {}
    };
  }

  // Merge resolved params into captured values for condition evaluation
  Object.assign(capturedValues, resolved);

  for (let i = 0; i < recipe.steps.length; i++) {
    const step = recipe.steps[i];

    // Check abort signal
    if (options.abortSignal?.aborted) {
      return {
        recipeName: recipe.name,
        success: false,
        stepsCompleted: i,
        totalSteps: recipe.steps.length,
        results,
        totalDurationMs: Date.now() - startTime,
        capturedValues
      };
    }

    // Evaluate condition
    if (step.condition && !evaluateCondition(step.condition, capturedValues)) {
      results.push({
        stepId: step.id,
        success: true,
        output: { skipped: true, reason: `Condition "${step.condition}" not met.` },
        durationMs: 0,
        retryCount: 0
      });
      continue;
    }

    options.onStepStart?.(step, i);

    const resolvedArgs = resolveTemplateArgs(step.args, { ...resolved, ...capturedValues });
    const stepStart = Date.now();
    let lastResult: StepResult | null = null;

    // Retry loop
    const maxRetries = step.retries ?? 0;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const dispatchResult = await dispatchToolCall(step.tool, resolvedArgs);

        lastResult = {
          stepId: step.id,
          success: !dispatchResult.haltTurn,
          output: dispatchResult.content,
          durationMs: Date.now() - stepStart,
          retryCount: attempt
        };

        if (lastResult.success) break;
      } catch (err: any) {
        lastResult = {
          stepId: step.id,
          success: false,
          output: { error: err.message },
          durationMs: Date.now() - stepStart,
          retryCount: attempt
        };
      }
    }

    if (lastResult) {
      results.push(lastResult);
      options.onStepComplete?.(step, lastResult);

      // Capture output
      if (step.capture && lastResult.success) {
        capturedValues[step.capture] = lastResult.output;
      }

      // Fail-fast check
      if (!lastResult.success && step.failFast !== false) {
        return {
          recipeName: recipe.name,
          success: false,
          stepsCompleted: i + 1,
          totalSteps: recipe.steps.length,
          results,
          totalDurationMs: Date.now() - startTime,
          capturedValues
        };
      }
    }
  }

  return {
    recipeName: recipe.name,
    success: true,
    stepsCompleted: recipe.steps.length,
    totalSteps: recipe.steps.length,
    results,
    totalDurationMs: Date.now() - startTime,
    capturedValues
  };
}
