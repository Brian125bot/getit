/**
 * @module planning/plan-queue
 * @description Dry-run plan queue for staged tool execution.
 *
 * v2.0: PlannedToolName is now a string union that accepts any tool name,
 * including dynamically loaded plugin tools.
 */

/**
 * v2.0: PlannedToolName is a string to support plugin tool names.
 * Built-in tools are still 'execute_bash' | 'manage_file'.
 */
export type PlannedToolName = string;

export interface PlannedToolCall {
  id: string;
  tool: PlannedToolName;
  args: any;
  risks: string[];
  mutating: boolean;
}

export class PlanQueue {
  private calls: PlannedToolCall[] = [];

  add(call: PlannedToolCall): void {
    this.calls.push(call);
  }

  all(): PlannedToolCall[] {
    return [...this.calls];
  }

  mutations(): PlannedToolCall[] {
    return this.calls.filter((call) => call.mutating);
  }

  clear(): void {
    this.calls = [];
  }

  hasScheduledCreate(filePath: string): boolean {
    return this.calls.some((call) =>
      call.tool === 'manage_file' &&
      call.args?.action === 'create' &&
      call.args?.path === filePath
    );
  }
}

export function isMutatingToolCall(tool: PlannedToolName, args: any): boolean {
  if (tool === 'execute_bash') return true;
  if (tool === 'manage_file') return args?.action === 'create' || args?.action === 'patch';
  // v2.0: Plugin tools are assumed mutating by default (conservative)
  if (tool !== 'execute_bash' && tool !== 'manage_file') return true;
  return false;
}

export function renderRoadmap(queue: PlanQueue): string {
  const lines = ['# getit Dry-Run Roadmap', ''];
  const mutations = queue.mutations();
  if (mutations.length === 0) {
    lines.push('No mutating actions were planned.');
    return lines.join('\n');
  }

  mutations.forEach((call, index) => {
    lines.push(`## ${index + 1}. ${call.tool}`);
    if (call.tool === 'execute_bash') {
      lines.push('');
      lines.push('```bash');
      lines.push(call.args.command);
      lines.push('```');
      if (call.args.working_directory) lines.push(`Working directory: \`${call.args.working_directory}\``);
    } else if (call.tool === 'manage_file') {
      lines.push(`Action: \`${call.args.action}\``);
      lines.push(`Path: \`${call.args.path}\``);
      if (call.args.action === 'patch') {
        lines.push('');
        lines.push('```diff');
        lines.push(`- ${call.args.search ?? ''}`);
        lines.push(`+ ${call.args.replace ?? ''}`);
        lines.push('```');
      }
    } else {
      // v2.0: Generic plugin tool display
      lines.push(`Plugin Tool: \`${call.tool}\``);
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(call.args, null, 2));
      lines.push('```');
    }
    if (call.risks.length > 0) {
      lines.push(`Risks: ${call.risks.join('; ')}`);
    }
    lines.push('');
  });

  return lines.join('\n');
}
