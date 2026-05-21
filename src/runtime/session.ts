import { randomUUID } from 'node:crypto';
import { MaskingSession } from '../security/scrubber.js';
import { PlanQueue } from '../planning/plan-queue.js';

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
