/**
 * @module carriers/openrouter/router
 * @description Intelligent model routing for the OpenRouter auto-switcher.
 *
 * Analyzes the current task context (code complexity, required context length,
 * user preferences, cost limits) and selects the optimal model automatically.
 */
import type { ModelInfo, ModelCapability } from './catalog.js';
import { fetchCatalog } from './catalog.js';

export interface RoutingContext {
  /** Estimated prompt token count. */
  promptTokens: number;
  /** Type of task being performed. */
  taskType: 'code' | 'chat' | 'reasoning' | 'review' | 'general';
  /** Maximum cost per request in dollars. */
  maxCostPerRequest?: number;
  /** Preferred providers (e.g., ['anthropic', 'openai']). */
  preferredProviders?: string[];
  /** Minimum context length needed. */
  minContextLength?: number;
  /** Whether function calling is needed. */
  needsFunctionCalling?: boolean;
  /** Whether vision is needed. */
  needsVision?: boolean;
  /** Explicit model override (bypasses routing). */
  modelOverride?: string;
}

export interface RoutingDecision {
  modelId: string;
  modelName: string;
  reason: string;
  estimatedCost: number;
  score: number;
  alternatives: Array<{ modelId: string; score: number; reason: string }>;
}

/**
 * Select the optimal model for the given context.
 */
export async function routeModel(
  context: RoutingContext,
  apiKey?: string
): Promise<RoutingDecision> {
  // If explicit override, use it
  if (context.modelOverride) {
    return {
      modelId: context.modelOverride,
      modelName: context.modelOverride,
      reason: 'User specified model override.',
      estimatedCost: 0,
      score: 100,
      alternatives: []
    };
  }

  const catalog = await fetchCatalog(apiKey);
  const scored = catalog
    .map(model => ({
      model,
      score: scoreModel(model, context)
    }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    throw new Error('No suitable model found for the given context.');
  }

  const best = scored[0];
  const estimatedCost =
    (context.promptTokens * best.model.pricing.prompt) +
    (Math.min(context.promptTokens, best.model.maxOutput) * best.model.pricing.completion);

  return {
    modelId: best.model.id,
    modelName: best.model.name,
    reason: explainChoice(best.model, context),
    estimatedCost,
    score: best.score,
    alternatives: scored.slice(1, 4).map(s => ({
      modelId: s.model.id,
      score: s.score,
      reason: explainChoice(s.model, context)
    }))
  };
}

/**
 * Score a model against the routing context.
 */
function scoreModel(model: ModelInfo, context: RoutingContext): number {
  let score = 50; // Base score

  // Context length — model must have enough context
  const requiredContext = context.minContextLength || context.promptTokens * 1.5;
  if (model.contextLength < requiredContext) return 0; // Instant disqualify

  // Cost constraint
  if (context.maxCostPerRequest !== undefined) {
    const estimatedCost = context.promptTokens * model.pricing.prompt;
    if (estimatedCost > context.maxCostPerRequest) return 0;
    // Bonus for being well under budget
    score += (1 - estimatedCost / context.maxCostPerRequest) * 10;
  }

  // Capability matching
  const neededCaps = taskTypeToCaps(context.taskType);
  for (const cap of neededCaps) {
    if (model.capabilities.includes(cap)) score += 15;
  }

  if (context.needsFunctionCalling && !model.capabilities.includes('function_calling')) {
    score -= 20;
  }
  if (context.needsVision && !model.capabilities.includes('vision')) {
    return 0; // Hard requirement
  }

  // Provider preference
  if (context.preferredProviders?.length) {
    if (context.preferredProviders.includes(model.provider)) {
      score += 20;
    }
  }

  // Free models get a small bonus for cost-conscious users
  if (model.isFree) score += 5;

  // Penalize very expensive models slightly
  if (model.pricing.prompt > 0.00003) score -= 5;
  if (model.pricing.prompt > 0.00006) score -= 10;

  // Bonus for larger context (more headroom)
  if (model.contextLength >= 128000) score += 5;
  if (model.contextLength >= 200000) score += 5;

  return Math.max(0, score);
}

/**
 * Map task types to required capabilities.
 */
function taskTypeToCaps(taskType: RoutingContext['taskType']): ModelCapability[] {
  switch (taskType) {
    case 'code': return ['code', 'function_calling'];
    case 'reasoning': return ['reasoning'];
    case 'review': return ['code'];
    case 'chat': return ['chat'];
    default: return ['chat'];
  }
}

/**
 * Generate a human-readable explanation of why a model was chosen.
 */
function explainChoice(model: ModelInfo, context: RoutingContext): string {
  const reasons: string[] = [];

  if (model.capabilities.includes('code') && context.taskType === 'code') {
    reasons.push('optimized for code');
  }
  if (model.capabilities.includes('reasoning') && context.taskType === 'reasoning') {
    reasons.push('strong reasoning capability');
  }
  if (model.isFree) {
    reasons.push('zero cost');
  } else if (model.pricing.prompt < 0.000005) {
    reasons.push('very affordable');
  }
  if (model.contextLength >= 128000) {
    reasons.push(`${Math.round(model.contextLength / 1000)}k context`);
  }

  return reasons.length > 0 ? reasons.join(', ') : 'general purpose model';
}

/**
 * Render a routing decision for terminal display.
 */
export function renderRoutingDecision(decision: RoutingDecision): string {
  const lines: string[] = [
    `\x1b[1;36m  Model Selected:\x1b[0m \x1b[1;37m${decision.modelName}\x1b[0m`,
    `  \x1b[2mReason: ${decision.reason}\x1b[0m`,
    `  \x1b[2mEstimated cost: $${decision.estimatedCost.toFixed(6)}\x1b[0m`,
  ];

  if (decision.alternatives.length > 0) {
    lines.push('  \x1b[2mAlternatives:\x1b[0m');
    for (const alt of decision.alternatives) {
      lines.push(`    \x1b[2m- ${alt.modelId} (${alt.reason})\x1b[0m`);
    }
  }

  return lines.join('\n');
}
