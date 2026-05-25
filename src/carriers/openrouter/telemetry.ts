/**
 * @module carriers/openrouter/telemetry
 * @description Usage telemetry and cost tracking for the OpenRouter auto-switcher.
 *
 * Tracks per-model usage statistics (tokens, latency, cost, errors) to
 * inform future routing decisions and provide usage reports.
 */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

export interface UsageRecord {
  modelId: string;
  timestamp: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  cost: number;
  success: boolean;
  errorType?: string;
}

export interface ModelStats {
  modelId: string;
  totalRequests: number;
  successCount: number;
  failureCount: number;
  totalTokens: number;
  totalCost: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  lastUsed: number;
}

export interface SessionTelemetry {
  sessionStart: number;
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  modelBreakdown: Map<string, ModelStats>;
}

const TELEMETRY_DIR = path.join(os.homedir(), '.config', 'getit', 'telemetry');
const MAX_RECORDS_IN_MEMORY = 500;

let records: UsageRecord[] = [];
let sessionStart = Date.now();

/**
 * Record a usage event.
 */
export function recordUsage(record: UsageRecord): void {
  records.push(record);
  if (records.length > MAX_RECORDS_IN_MEMORY) {
    records = records.slice(-MAX_RECORDS_IN_MEMORY);
  }
}

/**
 * Get aggregated stats for a specific model.
 */
export function getModelStats(modelId: string): ModelStats {
  const modelRecords = records.filter(r => r.modelId === modelId);

  if (modelRecords.length === 0) {
    return {
      modelId,
      totalRequests: 0,
      successCount: 0,
      failureCount: 0,
      totalTokens: 0,
      totalCost: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      lastUsed: 0
    };
  }

  const successes = modelRecords.filter(r => r.success);
  const latencies = modelRecords.map(r => r.latencyMs).sort((a, b) => a - b);
  const p95Index = Math.floor(latencies.length * 0.95);

  return {
    modelId,
    totalRequests: modelRecords.length,
    successCount: successes.length,
    failureCount: modelRecords.length - successes.length,
    totalTokens: modelRecords.reduce((sum, r) => sum + r.totalTokens, 0),
    totalCost: modelRecords.reduce((sum, r) => sum + r.cost, 0),
    avgLatencyMs: latencies.reduce((sum, l) => sum + l, 0) / latencies.length,
    p95LatencyMs: latencies[p95Index] || 0,
    lastUsed: Math.max(...modelRecords.map(r => r.timestamp))
  };
}

/**
 * Get the session-level telemetry summary.
 */
export function getSessionTelemetry(): SessionTelemetry {
  const modelBreakdown = new Map<string, ModelStats>();

  const modelIds = [...new Set(records.map(r => r.modelId))];
  for (const id of modelIds) {
    modelBreakdown.set(id, getModelStats(id));
  }

  return {
    sessionStart,
    totalRequests: records.length,
    totalTokens: records.reduce((sum, r) => sum + r.totalTokens, 0),
    totalCost: records.reduce((sum, r) => sum + r.cost, 0),
    modelBreakdown
  };
}

/**
 * Persist telemetry to disk for long-term tracking.
 */
export async function flushTelemetry(): Promise<void> {
  if (records.length === 0) return;

  await fsp.mkdir(TELEMETRY_DIR, { recursive: true });

  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const filePath = path.join(TELEMETRY_DIR, `${date}.ndjson`);

  const lines = records.map(r => JSON.stringify(r)).join('\n') + '\n';
  await fsp.appendFile(filePath, lines, 'utf-8');
}

/**
 * Load historical telemetry from disk.
 */
export async function loadHistory(days: number = 7): Promise<UsageRecord[]> {
  const allRecords: UsageRecord[] = [];

  try {
    const entries = await fsp.readdir(TELEMETRY_DIR);
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);

    for (const entry of entries.sort().reverse()) {
      if (!entry.endsWith('.ndjson')) continue;

      const content = await fsp.readFile(path.join(TELEMETRY_DIR, entry), 'utf-8');
      const fileRecords = content
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line) as UsageRecord)
        .filter(r => r.timestamp >= cutoff);

      allRecords.push(...fileRecords);
    }
  } catch { /* directory may not exist */ }

  return allRecords;
}

/**
 * Clear in-memory telemetry (start fresh session).
 */
export function resetSession(): void {
  records = [];
  sessionStart = Date.now();
}

/**
 * Render a telemetry report for terminal display.
 */
export function renderTelemetryReport(): string {
  const session = getSessionTelemetry();
  const duration = Math.round((Date.now() - session.sessionStart) / 1000);

  const lines: string[] = [
    '\x1b[1;33m  Session Telemetry:\x1b[0m',
    `  Duration: ${formatDuration(duration)}`,
    `  Requests: ${session.totalRequests}`,
    `  Tokens:   ${session.totalTokens.toLocaleString()}`,
    `  Cost:     $${session.totalCost.toFixed(6)}`,
  ];

  if (session.modelBreakdown.size > 0) {
    lines.push('\n  \x1b[1;36mModel Breakdown:\x1b[0m');
    for (const [_, stats] of session.modelBreakdown) {
      const successRate = stats.totalRequests > 0
        ? Math.round(stats.successCount / stats.totalRequests * 100)
        : 0;
      lines.push(`    \x1b[1;37m${stats.modelId}\x1b[0m`);
      lines.push(`      ${stats.totalRequests} requests, ${successRate}% success, avg ${Math.round(stats.avgLatencyMs)}ms`);
      lines.push(`      ${stats.totalTokens.toLocaleString()} tokens, $${stats.totalCost.toFixed(6)}`);
    }
  }

  return lines.join('\n');
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
