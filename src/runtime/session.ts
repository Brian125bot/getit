/**
 * @module runtime/session
 * @description Global runtime session state for getit.
 *
 * v2.0: Extended with watch mode, vault, and recipe state fields.
 */
import { randomUUID } from 'node:crypto';
import { MaskingSession } from '../security/scrubber.js';
import { PlanQueue } from '../planning/plan-queue.js';
import { ViolationRecord } from '../security/guardrail-types.js';

export type PolicyProfile = 'strict' | 'normal' | 'override';

export interface RuntimeSession {
  promptId: string;
  transactionId: string;
  dryRun: boolean;
  approvedPlanIds: Set<string>;
  planQueue: PlanQueue;
  maskingSession: MaskingSession;
  policyProfile: PolicyProfile;
  mitlActive: boolean;
  processActive: boolean;
  suppressMitl: boolean;
  // v2.0 additions
  watchActive: boolean;
  vaultUnlocked: boolean;
  recipeRecording: boolean;
  activeRecipe: string | null;
  guardrailViolations: ViolationRecord[];
}

let session: RuntimeSession = createRuntimeSession();

export function createRuntimeSession(overrides: Partial<RuntimeSession> = {}): RuntimeSession {
  return {
    promptId: `prompt_${randomUUID()}`,
    transactionId: `tx_${randomUUID()}`,
    dryRun: false,
    approvedPlanIds: new Set<string>(),
    planQueue: new PlanQueue(),
    maskingSession: new MaskingSession(),
    policyProfile: 'normal',
    mitlActive: false,
    processActive: false,
    suppressMitl: false,
    // v2.0 defaults
    watchActive: false,
    vaultUnlocked: false,
    recipeRecording: false,
    activeRecipe: null,
    guardrailViolations: [],
    ...overrides
  };
}

export function getRuntimeSession(): RuntimeSession {
  return session;
}

export function configureRuntimeSession(overrides: Partial<RuntimeSession>): RuntimeSession {
  session = { ...session, ...overrides };
  return session;
}

export function startPromptTransaction(): RuntimeSession {
  session.promptId = `prompt_${randomUUID()}`;
  session.transactionId = `tx_${randomUUID()}`;
  session.planQueue.clear();
  session.approvedPlanIds.clear();
  return session;
}
