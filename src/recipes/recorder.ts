/**
 * @module recipes/recorder
 * @description Live recipe recording from interactive sessions.
 *
 * When the user starts recording (`/recipe record`), all tool calls
 * dispatched during the session are captured as recipe steps. When
 * recording stops, the user can save the recipe to YAML.
 */
import type { RecipeStep, RecordingSession, Recipe, RecipeParameter } from './types.js';
import { serializeRecipeYaml } from './yaml-parser.js';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

let activeRecording: RecordingSession | null = null;

/**
 * Start recording a new recipe.
 */
export function startRecording(name: string, description: string): void {
  if (activeRecording) {
    throw new Error(`Already recording recipe "${activeRecording.name}". Stop it first.`);
  }
  activeRecording = {
    name,
    description,
    steps: [],
    startedAt: new Date().toISOString(),
    parameters: []
  };
}

/**
 * Check if a recording session is active.
 */
export function isRecording(): boolean {
  return activeRecording !== null;
}

/**
 * Get current recording session info.
 */
export function getRecordingSession(): RecordingSession | null {
  return activeRecording;
}

/**
 * Record a tool call as a recipe step.
 * Called from the dispatch pipeline when recording is active.
 */
export function recordStep(
  toolName: string,
  args: Record<string, unknown>,
  description: string = ''
): void {
  if (!activeRecording) return;

  const stepId = `step_${activeRecording.steps.length + 1}`;
  const step: RecipeStep = {
    id: stepId,
    description: description || `${toolName} call`,
    tool: toolName,
    args: sanitizeArgsForRecording(args),
    failFast: true
  };

  activeRecording.steps.push(step);
}

/**
 * Stop recording and return the assembled recipe.
 */
export function stopRecording(): Recipe | null {
  if (!activeRecording) return null;

  const recipe: Recipe = {
    name: activeRecording.name,
    description: activeRecording.description,
    version: '1.0.0',
    parameters: activeRecording.parameters,
    steps: activeRecording.steps,
    tags: ['recorded']
  };

  activeRecording = null;
  return recipe;
}

/**
 * Cancel active recording without saving.
 */
export function cancelRecording(): boolean {
  if (!activeRecording) return false;
  activeRecording = null;
  return true;
}

/**
 * Save a recipe to the workspace recipe directory.
 */
export async function saveRecipeToWorkspace(
  recipe: Recipe,
  workspaceRoot: string
): Promise<string> {
  const recipesDir = path.join(workspaceRoot, '.getit', 'recipes');
  await fsp.mkdir(recipesDir, { recursive: true });

  const filePath = path.join(recipesDir, `${recipe.name}.yaml`);
  const yaml = serializeRecipeYaml(recipe);
  await fsp.writeFile(filePath, yaml, 'utf-8');

  return filePath;
}

/**
 * Save a recipe to the global recipe directory.
 */
export async function saveRecipeGlobal(recipe: Recipe): Promise<string> {
  const recipesDir = path.join(os.homedir(), '.config', 'getit', 'recipes');
  await fsp.mkdir(recipesDir, { recursive: true });

  const filePath = path.join(recipesDir, `${recipe.name}.yaml`);
  const yaml = serializeRecipeYaml(recipe);
  await fsp.writeFile(filePath, yaml, 'utf-8');

  return filePath;
}

/**
 * Sanitize args for recording — remove absolute paths that may be machine-specific
 * and replace them with template parameters.
 */
function sanitizeArgsForRecording(args: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  const homeDir = os.homedir();

  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && value.startsWith(homeDir)) {
      sanitized[key] = value.replace(homeDir, '{{home}}');
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
