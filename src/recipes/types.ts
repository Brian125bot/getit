/**
 * @module recipes/types
 * @description Type definitions for the getit v2.0 Task Recipe system.
 *
 * Task recipes are replayable, parameterized sequences of tool calls.
 * They can be authored as YAML, recorded from live sessions, or generated
 * by the LLM. Each step goes through MITL approval on first run but can
 * be auto-approved on replay if the user trusts the recipe.
 */

/**
 * A single step in a recipe.
 */
export interface RecipeStep {
  /** Unique step identifier within the recipe. */
  id: string;
  /** Human-readable step description. */
  description: string;
  /** Tool name to invoke (built-in or plugin). */
  tool: string;
  /** Arguments for the tool call. Supports `{{param}}` template syntax. */
  args: Record<string, unknown>;
  /** If true, failure of this step halts the entire recipe. Default: true. */
  failFast?: boolean;
  /** Conditional execution expression (simple boolean checks on previous results). */
  condition?: string;
  /** Capture the output of this step into a named variable. */
  capture?: string;
  /** Max retries on failure before giving up. Default: 0. */
  retries?: number;
}

/**
 * A complete recipe definition.
 */
export interface Recipe {
  /** Unique recipe name. Must match /^[a-z][a-z0-9_-]{1,63}$/ */
  name: string;
  /** Human-readable description. */
  description: string;
  /** Semantic version of the recipe. */
  version: string;
  /** Author identifier. */
  author?: string;
  /** Parameter definitions for template variables. */
  parameters: RecipeParameter[];
  /** Ordered sequence of steps. */
  steps: RecipeStep[];
  /** Tags for categorization and search. */
  tags?: string[];
  /** Whether this recipe is trusted (auto-approves MITL). */
  trusted?: boolean;
}

/**
 * A recipe parameter definition.
 */
export interface RecipeParameter {
  /** Parameter name (used in `{{name}}` templates). */
  name: string;
  /** Human-readable description. */
  description: string;
  /** Parameter type for validation. */
  type: 'string' | 'number' | 'boolean' | 'path';
  /** Default value if not provided. */
  default?: unknown;
  /** Whether this parameter is required. */
  required: boolean;
}

/**
 * Result of executing a single recipe step.
 */
export interface StepResult {
  stepId: string;
  success: boolean;
  output: unknown;
  durationMs: number;
  retryCount: number;
}

/**
 * Result of executing an entire recipe.
 */
export interface RecipeExecutionResult {
  recipeName: string;
  success: boolean;
  stepsCompleted: number;
  totalSteps: number;
  results: StepResult[];
  totalDurationMs: number;
  capturedValues: Record<string, unknown>;
}

/**
 * A recipe currently being recorded from a live session.
 */
export interface RecordingSession {
  name: string;
  description: string;
  steps: RecipeStep[];
  startedAt: string;
  parameters: RecipeParameter[];
}
