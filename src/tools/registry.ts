import { executeBash } from './execute-bash.js';
import { manageFile } from './manage-file.js';
import { getRuntimeSession } from '../runtime/session.js';
import { isMutatingToolCall, PlannedToolCall, PlannedToolName } from '../planning/plan-queue.js';
import * as fs from 'node:fs';
import { assertPathAllowed } from '../security/path-policy.js';
import { scrubText } from '../security/scrubber.js';

export interface ToolDispatchResult {
  content: string;
  haltTurn: boolean;
}

export async function dispatchToolCall(name: string, args: any): Promise<ToolDispatchResult> {
  try {
    const session = getRuntimeSession();
    if (session.dryRun && (name === 'execute_bash' || name === 'manage_file')) {
      return dispatchDryRunToolCall(name, args);
    }

    if (name === 'execute_bash') {
      const command = args.command;
      const working_directory = args.working_directory;

      if (!command) {
        return { content: JSON.stringify({ error: 'Missing required parameter "command"' }), haltTurn: false };
      }

      const result = await executeBash(command, working_directory);
      return {
        content: JSON.stringify({
          stdout: result.contextStdout ?? result.stdout,
          stderr: result.contextStderr ?? result.stderr,
          exitCode: result.exitCode,
          error: result.error
        }),
        haltTurn: result.haltTurn
      };
    }

    if (name === 'manage_file') {
      const action = args.action;
      const filePath = args.path;
      const content = args.content;
      const search = args.search;
      const replace = args.replace;

      if (!action || !filePath) {
        return { content: JSON.stringify({ error: 'Missing required parameters "action" or "path"' }), haltTurn: false };
      }

      const result = await manageFile(action, filePath, content, search, replace);
      
      // Halts the turn if the action failed (e.g. search block not found, denied, safety exception)
      const haltTurn = !result.success;

      return {
        content: JSON.stringify(result),
        haltTurn
      };
    }

    return {
      content: JSON.stringify({ error: `Tool "${name}" is not implemented.` }),
      haltTurn: false
    };
  } catch (error: any) {
    return {
      content: JSON.stringify({ error: error.message }),
      haltTurn: true
    };
  }
}

function dispatchDryRunToolCall(name: PlannedToolName, args: any): ToolDispatchResult {
  const session = getRuntimeSession();
  const mutating = isMutatingToolCall(name, args);
  const id = `plan_${session.planQueue.all().length + 1}`;
  const call: PlannedToolCall = {
    id,
    tool: name,
    args,
    risks: inferRisks(name, args),
    mutating
  };

  if (name === 'manage_file' && args?.action === 'read') {
    const filePath = args.path;
    if (filePath && fs.existsSync(filePath) && !session.planQueue.hasScheduledCreate(filePath)) {
      return executeDryRunRead(args);
    }
    session.planQueue.add(call);
    return {
      content: JSON.stringify({
        success: true,
        content: `[DRY-RUN SIMULATED READ CONTENT FOR: ${filePath}]`,
        dryRun: true
      }),
      haltTurn: false
    };
  }

  session.planQueue.add(call);
  return {
    content: JSON.stringify({
      success: true,
      dryRun: true,
      queued: true,
      planId: id,
      message: `Dry-run queued ${name}. No system changes were made.`
    }),
    haltTurn: false
  };
}

function executeDryRunRead(args: any): ToolDispatchResult {
  assertPathAllowed(args.path);
  const session = getRuntimeSession();
  return {
    content: JSON.stringify({
      success: true,
      content: scrubText(fs.readFileSync(args.path, 'utf-8'), session.maskingSession),
      dryRun: true,
      liveRead: true
    }),
    haltTurn: false
  };
}

function inferRisks(name: PlannedToolName, args: any): string[] {
  const risks: string[] = [];
  if (name === 'execute_bash') risks.push('Command may mutate system state and cannot be automatically rolled back.');
  if (name === 'manage_file' && args?.action === 'patch') risks.push('File patch will be snapshotted before mutation.');
  if (name === 'manage_file' && args?.action === 'create') risks.push('File creation will be tracked for undo.');
  return risks;
}

export async function executePlannedCall(call: PlannedToolCall): Promise<ToolDispatchResult> {
  const session = getRuntimeSession();
  const previousDryRun = session.dryRun;
  const previousSuppressMitl = session.suppressMitl;
  session.dryRun = false;
  session.suppressMitl = true;
  try {
    return await dispatchToolCall(call.tool, call.args);
  } finally {
    session.dryRun = previousDryRun;
    session.suppressMitl = previousSuppressMitl;
  }
}
