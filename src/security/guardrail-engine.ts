import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { ViolationRecord } from './guardrail-types.js';
import { globMatch } from './policy.js';

export interface InvariantRule {
  id: string;
  description: string;
  severity: 'warn' | 'block';
  targetPaths: string[];
  forbiddenPatterns: string[];
  allowedPatterns?: string[];
  remediationHint: string;
}

export interface GuardrailPolicyManifest {
  enabled: boolean;
  rules: InvariantRule[];
}

let cachedPolicy: GuardrailPolicyManifest | null = null;
let lastPolicyPath: string | null = null;

export async function loadPolicy(workspaceRoot: string): Promise<GuardrailPolicyManifest> {
  const policyPath = path.join(workspaceRoot, '.getit', 'policy.json');

  if (cachedPolicy && lastPolicyPath === policyPath) {
    return cachedPolicy;
  }

  try {
    const content = await fsp.readFile(policyPath, 'utf-8');
    const parsed = JSON.parse(content) as GuardrailPolicyManifest;

    if (typeof parsed.enabled !== 'boolean' || !Array.isArray(parsed.rules)) {
      throw new Error('Invalid policy structure');
    }

    cachedPolicy = parsed;
    lastPolicyPath = policyPath;
    return parsed;
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return { enabled: false, rules: [] };
    }
    // Fail-closed for corrupted/invalid JSON
    return {
      enabled: true,
      rules: [{
        id: 'policy-corruption',
        description: 'The .getit/policy.json file is corrupted or invalid.',
        severity: 'block',
        targetPaths: ['**/*'],
        forbiddenPatterns: ['.*'],
        remediationHint: 'Fix the JSON syntax in .getit/policy.json',
      }]
    };
  }
}

export async function validateWorkspaceFile(filePath: string, workspaceRoot: string): Promise<ViolationRecord[]> {
  const policy = await loadPolicy(workspaceRoot);
  if (!policy.enabled) return [];

  const relativePath = path.relative(workspaceRoot, filePath);
  const applicableRules = policy.rules.filter(rule =>
    rule.targetPaths.some(pattern => globMatch(pattern, relativePath))
  );

  if (applicableRules.length === 0) return [];

  const violations: ViolationRecord[] = [];
  try {
    const content = await fsp.readFile(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);

    for (const rule of applicableRules) {
      const forbiddenRegexes = rule.forbiddenPatterns.map(p => new RegExp(p));
      const allowedRegexes = (rule.allowedPatterns || []).map(p => new RegExp(p));

      lines.forEach((line, index) => {
        // Skip if line matches any allowed pattern
        if (allowedRegexes.some(re => re.test(line))) return;

        if (forbiddenRegexes.some(re => re.test(line))) {
          violations.push({
            ruleId: rule.id,
            description: rule.description,
            severity: rule.severity,
            filePath,
            line: index + 1,
            lineContent: line.trim(),
            remediationHint: rule.remediationHint,
            timestamp: Date.now()
          });
        }
      });
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      // If we can't read a file that should be there, it might be a transient issue or
      // permissions, but for guardrails we should probably report it if it's a target.
    }
  }

  return violations;
}

export function clearPolicyCache(): void {
  cachedPolicy = null;
  lastPolicyPath = null;
}
