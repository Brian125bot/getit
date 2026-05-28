export interface ViolationRecord {
  ruleId: string;
  description: string;
  severity: 'warn' | 'block';
  filePath: string;
  line?: number;
  lineContent?: string;
  remediationHint: string;
  timestamp: number;
}
