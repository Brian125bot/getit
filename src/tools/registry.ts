import { executeBash } from './execute-bash.js';
import { manageFile } from './manage-file.js';

export interface ToolDispatchResult {
  content: string;
  haltTurn: boolean;
}

export async function dispatchToolCall(name: string, args: any): Promise<ToolDispatchResult> {
  try {
    if (name === 'execute_bash') {
      const command = args.command;
      const working_directory = args.working_directory;

      if (!command) {
        return { content: JSON.stringify({ error: 'Missing required parameter "command"' }), haltTurn: false };
      }

      const result = await executeBash(command, working_directory);
      return {
        content: JSON.stringify({
          stdout: result.stdout,
          stderr: result.stderr,
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
