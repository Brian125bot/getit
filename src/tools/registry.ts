/**
 * @module tools/registry
 * @description Central tool dispatch registry.
 *
 * v2.0: Extended with plugin tool fallback dispatch. If a tool name is not
 * a built-in (execute_bash, manage_file), it's dispatched to the plugin registry.
 */
import { executeBash } from './execute-bash.js';
import { manageFile } from './manage-file.js';
import { getRuntimeSession } from '../runtime/session.js';
import { isMutatingToolCall, PlannedToolCall } from '../planning/plan-queue.js';
import { executePlugin } from '../plugins/registry.js';
import * as fsp from 'node:fs/promises';
import { assertPathAllowed } from '../security/path-policy.js';
import { scrubText } from '../security/scrubber.js';

export interface ToolDispatchResult {
  content: string;
  haltTurn: boolean;
  clarifyRequest?: string;
}

export async function dispatchToolCall(name: string, args: any): Promise<ToolDispatchResult> {
  try {
    const session = getRuntimeSession();
    if (session.dryRun && (name === 'execute_bash' || name === 'manage_file')) {
      return await dispatchDryRunToolCall(name as 'execute_bash' | 'manage_file', args);
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
        haltTurn: result.haltTurn,
        clarifyRequest: result.clarifyRequest
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
      
      // Halts the turn if the action was explicitly denied by the user. Let other errors auto-retry.
      const haltTurn = !result.success && !result.clarifyRequest && (result.error?.includes('denied by user') || false);

      return {
        content: JSON.stringify(result),
        haltTurn,
        clarifyRequest: result.clarifyRequest
      };
    }

    // v2.0: Plugin tool dispatch fallback
    try {
      const pluginResult = await executePlugin(name, args);
      return {
        content: JSON.stringify(pluginResult),
        haltTurn: false
      };
    } catch (pluginErr: any) {
      // If plugin not found either, return unknown tool error
      if (pluginErr.message?.includes('not found')) {
        return {
          content: JSON.stringify({ error: `Tool "${name}" is not implemented and no matching plugin found.` }),
          haltTurn: false
        };
      }
      return {
        content: JSON.stringify({ error: `Plugin error: ${pluginErr.message}` }),
        haltTurn: true
      };
    }
  } catch (error: any) {
    return {
      content: JSON.stringify({ error: error.message }),
      haltTurn: true
    };
  }
}

async function dispatchDryRunToolCall(name: 'execute_bash' | 'manage_file', args: any): Promise<ToolDispatchResult> {
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
    let exists = false;
    try { await fsp.access(filePath); exists = true; } catch {}
    if (filePath && exists && !session.planQueue.hasScheduledCreate(filePath)) {
      return await executeDryRunRead(args);
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

async function executeDryRunRead(args: any): Promise<ToolDispatchResult> {
  await assertPathAllowed(args.path);
  const session = getRuntimeSession();
  const content = await fsp.readFile(args.path, 'utf-8');
  return {
    content: JSON.stringify({
      success: true,
      content: scrubText(content, session.maskingSession),
      dryRun: true,
      liveRead: true
    }),
    haltTurn: false
  };
}

function inferRisks(name: string, args: any): string[] {
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
