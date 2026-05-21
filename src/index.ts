import { parseArgs } from 'node:util';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getReadlineInterface, closeReadlineInterface, interceptToolCall } from './mitl/interceptor.js';
import { discoverEnvironment } from './discovery/environment.js';
import { buildSystemPrompt } from './agent/prompt.js';
import { AgentLoop } from './agent/loop.js';
import { loadApiKey } from './security/secrets-loader.js';
import { runSetupWizard } from './setup/wizard.js';
import { setActiveModel, getActiveModel } from './agent/client.js';
import { setDefaultTimeout, getDefaultTimeout, getActiveCwd, setActiveCwd } from './tools/execute-bash.js';

// Dynamic version loader resolving relative to both source and compiled dist paths
function getVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    
    // Check multiple relative depths depending on active cwd / dist structures
    const pathsToTry = [
      join(__dirname, '../package.json'),
      join(__dirname, '../../package.json'),
      join(process.cwd(), 'package.json')
    ];

    for (const p of pathsToTry) {
      if (existsSync(p)) {
        const pkg = JSON.parse(readFileSync(p, 'utf-8'));
        if (pkg.version) return pkg.version;
      }
    }
  } catch {
    // Fallback if not found
  }
  return '1.0.0';
}

async function bootstrap() {
  // 1. CLI Argument Parsing using native node:util parseArgs
  const options = {
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
    model: { type: 'string' },
    timeout: { type: 'string' },
    'allow-root': { type: 'boolean' },
    setup: { type: 'boolean' }
  } as const;

  let values: any = {};
  let positionals: string[] = [];

  try {
    const parsed = parseArgs({ options, allowPositionals: true });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (err: any) {
    console.error(`\x1b[31mArgument Error: ${err.message}\x1b[0m`);
    printCliUsage();
    process.exit(1);
  }

  // 1.5 Safety Check: Prevent running as root unless explicitly overridden
  if (process.getuid && process.getuid() === 0 && !values['allow-root']) {
    console.error('\x1b[1;31mError: Running getit as root is prohibited for safety.\x1b[0m');
    console.error('Please run as a standard user, or pass --allow-root to override.');
    process.exit(1);
  }

  // 1.8 Interactive Setup: Run setup wizard if --setup flag is provided
  if (values.setup) {
    try {
      await runSetupWizard();
      process.exit(0);
    } catch (err: any) {
      console.error(`\x1b[31mSetup Error: ${err.message}\x1b[0m`);
      process.exit(1);
    }
  }

  // 2. Handle CLI Commands/Flags
  if (values.help) {
    printCliUsage();
    process.exit(0);
  }

  if (values.version) {
    console.log(`getit version ${getVersion()}`);
    process.exit(0);
  }

  if (values.model) {
    setActiveModel(values.model);
  } else if (process.env.GETIT_MODEL) {
    setActiveModel(process.env.GETIT_MODEL);
  }

  if (values.timeout) {
    const parsedTimeout = parseInt(values.timeout, 10);
    if (!isNaN(parsedTimeout) && parsedTimeout > 0) {
      setDefaultTimeout(parsedTimeout);
    } else {
      console.error('\x1b[31mError: Timeout must be a positive integer in milliseconds.\x1b[0m');
      process.exit(1);
    }
  }

  // 3. Check for MOCK_TOOL_CALL (Stage 1 Test compatibility)
  if (process.env.MOCK_TOOL_CALL === 'true') {
    try {
      const result = await interceptToolCall(
        'BASH',
        'echo "Mock execution of test payload"'
      );
      if (result.approved) {
        console.log(`Approved mock command: ${result.payload}`);
      } else {
        console.log(`Execution denied by user.`);
      }
      closeReadlineInterface();
      process.exit(0);
    } catch {
      process.exit(1);
    }
  }

  // 4. Load API Key — launch guided wizard if missing
  let apiKey = loadApiKey();
  if (!apiKey) {
    // If running in one-shot mode or non-interactive context, don't trigger the wizard
    if (positionals.length > 0 || !process.stdout.isTTY) {
      console.error('\x1b[1;31mError: OPENROUTER_API_KEY is not set.\x1b[0m');
      console.error('Please export OPENROUTER_API_KEY="your-key-here" or save it inside a .env or .getitrc file.');
      process.exit(1);
    }
    apiKey = await runSetupWizard();
  }

  // 5. Perform environmental discovery
  const env = discoverEnvironment();

  // 6. Build system prompt
  const systemPrompt = buildSystemPrompt();

  // 7. Initialize agent loop statefully
  const agent = new AgentLoop(systemPrompt);

  // 8. One-shot Execution Mode (E.g. getit "Create a hello world python file")
  if (positionals.length > 0) {
    const oneShotPrompt = positionals.join(' ');
    console.log(`\x1b[36m[getit] Running in one-shot mode with prompt: "${oneShotPrompt}"\x1b[0m\n`);
    try {
      await agent.runTurn(oneShotPrompt);
    } catch (err: any) {
      console.error(`\x1b[31mExecution Error: ${err.message}\x1b[0m`);
      process.exit(1);
    }
    closeReadlineInterface();
    process.exit(0);
  }

  // 9. Interactive REPL Loop
  // Draw Dashboard welcome banner
  console.log(`\n\x1b[1;36m┌────────────────────────────────────────────────────────┐`);
  console.log(`│ \x1b[1;32mGETIT WORKSPACE AGENT v${getVersion().padEnd(10)}\x1b[1;36m                         │`);
  console.log(`├────────────────────────────────────────────────────────┤`);
  console.log(`│ \x1b[1;37mArchitecture:\x1b[0m  ${env.arch.padEnd(40)} \x1b[1;36m│`);
  console.log(`│ \x1b[1;37mPlatform:\x1b[0m      ${env.osName.padEnd(40)} \x1b[1;36m│`);
  
  const deps = Object.entries(env.binaries)
    .map(([k, v]) => `${k}:${v ? '✓' : '✗'}`)
    .join(' ');
  console.log(`│ \x1b[1;37mDependencies:\x1b[0m  ${deps.padEnd(40)} \x1b[1;36m│`);
  
  const pathStatus = env.localBinInPath ? 'Registered ✓' : 'NOT in PATH ✗';
  console.log(`│ \x1b[1;37m~/.local/bin:\x1b[0m  ${pathStatus.padEnd(40)} \x1b[1;36m│`);
  console.log(`└────────────────────────────────────────────────────────┘\x1b[0m`);
  console.log('Type \x1b[1;33m/help\x1b[0m for available commands.\n');

  const rl = getReadlineInterface();

  // Handle Ctrl+C (SIGINT) cleanly
  rl.on('SIGINT', () => {
    console.log('\n\x1b[33m[getit] Session terminated via Ctrl+C. Exiting cleanly.\x1b[0m');
    closeReadlineInterface();
    process.exit(0);
  });

  // Handle standard 'exit' command or EOF (Ctrl+D)
  while (true) {
    const promptString = 'getit-agent ❯ ';
    
    try {
      const input = await rl.question(promptString);
      const cleanInput = input.trim();

      if (!cleanInput) {
        continue;
      }

      // --- Slash Command Dispatch ---
      if (cleanInput.startsWith('/')) {
        const handled = await handleSlashCommand(cleanInput, agent, systemPrompt);
        if (handled === 'exit') break;
        continue;
      }

      // Legacy plain-text exit
      if (cleanInput.toLowerCase() === 'exit') {
        printGoodbye();
        break;
      }

      // Execute a single agent turn
      await agent.runTurn(cleanInput);

    } catch (err: any) {
      if (err.message && err.message.includes('closed')) {
        break;
      }
      console.error(`\x1b[31mREPL Error: ${err.message}\x1b[0m`);
    }
  }

  closeReadlineInterface();
  process.exit(0);
}

// ─── Slash Command Handlers ────────────────────────────────────────────────────

async function handleSlashCommand(input: string, agent: AgentLoop, systemPrompt: string): Promise<string | void> {
  const parts = input.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const arg = parts.slice(1).join(' ').trim();

  switch (cmd) {
    case '/help':
      printHelp();
      return;
    case '/setup':
      await runSetupWizard();
      return;
    case '/exit':
    case '/quit':
      printGoodbye();
      return 'exit';
    case '/clear':
      process.stdout.write('\x1b[2J\x1b[H');
      return;
    case '/env':
      printEnvironment();
      return;
    case '/reset':
      agent.resetSession(systemPrompt);
      console.log('\n\x1b[32m✓ Conversation history successfully reset. Starting fresh session!\x1b[0m\n');
      return;
    case '/cd':
      if (!arg) {
        console.log(`\x1b[31m  Error: Missing directory argument. Usage: /cd <path>\x1b[0m`);
        return;
      }
      try {
        setActiveCwd(arg);
        console.log(`\x1b[32m  Working directory changed to: ${getActiveCwd()}\x1b[0m`);
      } catch (err: any) {
        console.log(`\x1b[31m  Error: ${err.message}\x1b[0m`);
      }
      return;
    case '/history': {
      const messages = agent.getMessages();
      console.log(`\n\x1b[1;36m  Conversation History Metrics:\x1b[0m`);
      console.log(`  Total Messages:   \x1b[1;37m${messages.length}\x1b[0m`);
      const userMsgs = messages.filter(m => m.role === 'user').length;
      const assistantMsgs = messages.filter(m => m.role === 'assistant').length;
      const toolMsgs = messages.filter(m => m.role === 'tool').length;
      console.log(`  - User Turns:     \x1b[1;37m${userMsgs}\x1b[0m`);
      console.log(`  - AI Invocations: \x1b[1;37m${assistantMsgs}\x1b[0m`);
      console.log(`  - Tool Invocations:\x1b[1;37m${toolMsgs}\x1b[0m`);
      console.log('');
      return;
    }
    case '/model':
      if (arg) {
        setActiveModel(arg);
        console.log(`\x1b[32m  Active model set to: ${getActiveModel()}\x1b[0m`);
      } else {
        console.log(`\n  Active Model: \x1b[1;37m${getActiveModel()}\x1b[0m`);
        console.log('  To change, type: \x1b[1;33m/model <model_name>\x1b[0m');
      }
      return;
    default:
      console.log(`\x1b[31m  Unknown command: ${cmd}\x1b[0m`);
      console.log('  Type \x1b[1;33m/help\x1b[0m to see available commands.\n');
      return;
  }
}

function printCliUsage(): void {
  console.log(`
Usage: getit [options] [prompt...]

An agentic terminal assistant that translates natural language into secure, checked system changes.

Arguments:
  prompt                Optional natural language instruction to execute in one-shot mode.

Options:
  -h, --help            Show this help guide and exit.
  -v, --version         Show semantic version and exit.
  --model <name>        Override the active OpenRouter completion LLM model.
  --timeout <ms>        Set the maximum child execution command timeout limit (in milliseconds).
  --allow-root          Override safety check blocking root execution.
  --setup               Launch interactive key setup wizard and exit.

Examples:
  $ getit                        # Launch full interactive multi-turn REPL
  $ getit install ripgrep        # Run command one-shot and exit
  $ getit --model qwen/qwen3-coder:free
  `);
}

function printHelp(): void {
  console.log('');
  console.log('\x1b[1;36m┌────────────────────────────────────────────────────────┐');
  console.log('│ \x1b[1;33mAVAILABLE COMMANDS\x1b[1;36m                                     │');
  console.log('├────────────────────────────────────────────────────────┤');
  console.log('│\x1b[0m                                                        \x1b[1;36m│');
  console.log('│\x1b[0m  \x1b[1;37m/help\x1b[0m        Show this help menu                      \x1b[1;36m│');
  console.log('│\x1b[0m  \x1b[1;37m/exit\x1b[0m        Exit the agent session                   \x1b[1;36m│');
  console.log('│\x1b[0m  \x1b[1;37m/quit\x1b[0m        Alias for /exit                          \x1b[1;36m│');
  console.log('│\x1b[0m  \x1b[1;37m/clear\x1b[0m       Clear the terminal screen                \x1b[1;36m│');
  console.log('│\x1b[0m  \x1b[1;37m/env\x1b[0m         Display discovered environment info      \x1b[1;36m│');
  console.log('│\x1b[0m  \x1b[1;37m/reset\x1b[0m       Clear conversation context starting fresh\x1b[1;36m│');
  console.log('│\x1b[0m  \x1b[1;37m/cd <path>\x1b[0m   Change stateful working directory        \x1b[1;36m│');
  console.log('│\x1b[0m  \x1b[1;37m/history\x1b[0m     Display session performance metrics      \x1b[1;36m│');
  console.log('│\x1b[0m  \x1b[1;37m/model\x1b[0m       Display or override the session model    \x1b[1;36m│');
  console.log('│\x1b[0m  \x1b[1;37m/setup\x1b[0m       Interactive guided API key configuration \x1b[1;36m│');
  console.log('│\x1b[0m                                                        \x1b[1;36m│');
  console.log('│\x1b[0m  \x1b[2mYou can also type "exit" or press Ctrl+C to quit.\x1b[0m      \x1b[1;36m│');
  console.log('│\x1b[0m  \x1b[2mAnything else is sent as a prompt to the AI agent.\x1b[0m     \x1b[1;36m│');
  console.log('│\x1b[0m                                                        \x1b[1;36m│');
  console.log('└────────────────────────────────────────────────────────┘\x1b[0m');
  console.log('');
}

function printEnvironment(): void {
  const env = discoverEnvironment();
  console.log('');
  console.log('\x1b[1;36m  Runtime Environment\x1b[0m');
  console.log(`  Architecture:   \x1b[1;37m${env.arch}\x1b[0m`);
  console.log(`  Platform:       \x1b[1;37m${env.osName}\x1b[0m`);
  const deps = Object.entries(env.binaries)
    .map(([k, v]) => `${k}:${v ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'}`)
    .join('  ');
  console.log(`  Dependencies:   ${deps}`);
  const pathStatus = env.localBinInPath ? '\x1b[32mRegistered ✓\x1b[0m' : '\x1b[31mNOT in PATH ✗\x1b[0m';
  console.log(`  ~/.local/bin:   ${pathStatus}`);
  const keyStatus = process.env.OPENROUTER_API_KEY ? '\x1b[32mConfigured ✓\x1b[0m' : '\x1b[31mMissing ✗\x1b[0m';
  console.log(`  API Key:        ${keyStatus}`);
  console.log(`  Active Model:   \x1b[1;37m${getActiveModel()}\x1b[0m`);
  console.log(`  Exec Timeout:   \x1b[1;37m${getDefaultTimeout()}ms\x1b[0m`);
  console.log(`  Stateful CWD:   \x1b[1;37m${getActiveCwd()}\x1b[0m`);
  console.log('');
}

function printGoodbye(): void {
  console.log('\x1b[33m[getit] Goodbye!\x1b[0m');
}

// Start the bootstrap routine
bootstrap().catch((err) => {
  console.error('Fatal initialization error:', err);
  process.exit(1);
});
