#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync, existsSync, statSync, unlinkSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getReadlineInterface, closeReadlineInterface, interceptToolCall } from './mitl/interceptor.js';
import { discoverEnvironment } from './discovery/environment.js';
import { buildSystemPrompt } from './agent/prompt.js';
import { AgentLoop } from './agent/loop.js';
import { loadConfig, configRequiresApiKey, getApiKeyEnvHints } from './security/secrets-loader.js';
import { runSetupWizard } from './setup/wizard.js';
import { setActiveModel, getActiveModel, initSessionModel } from './agent/client.js';
import { normalizeCarrierId, resolveActivePreset } from './carriers/registry.js';
import { listModels, formatModelList } from './carriers/models.js';
import { runDoctorChecks } from './carriers/doctor.js';
import { switchCarrier } from './carriers/session.js';
import { setDefaultTimeout, getDefaultTimeout, getActiveCwd, setActiveCwd } from './tools/execute-bash.js';
import { configureRuntimeSession, getRuntimeSession, PolicyProfile } from './runtime/session.js';
import { renderRoadmap } from './planning/plan-queue.js';
import { executePlannedCall } from './tools/registry.js';
import { undoLatestTransaction } from './backup/shadow-store.js';
import { initWorkspaceManifest, loadWorkspaceManifest, saveWorkspaceManifest, computeScrubbedHash } from './workspace/manifest.js';
import { detectWorkspaceDrift } from './workspace/drift.js';
import { inspectTrackedFile, stageToTracking, getTrackingRoot, scrubContentGeneric } from './workspace/tracking.js';
import { findWorkspaceRoot } from './workspace/boundary.js';
import { resolveLiveFilePath } from './workspace/profiles.js';
import { generateDiffPreview } from './tools/diff.js';
import { centerBlock, centerLine, centerPrompt, stripAnsi } from './ui/layout.js';
import { getDriftAdvice } from './workspace/drift-advisor.js';
import { WorkspaceHistoryManager } from './workspace/history.js';
import { WorkspaceRollbackManager } from './workspace/rollback.js';
import { exportScrubbedWorkspace } from './workspace/export.js';
import { checkForUpdates, performUpdate } from './update.js';

// ─── v2.0 Module Imports ────────────────────────────────────────────────────
import { loadAllPlugins } from './plugins/loader.js';
import { getAllPlugins, getPlugin, executePlugin, reloadPlugins, initPluginRegistry } from './plugins/registry.js';
import { initSessionMemory, buildSessionContext } from './memory/sessions.js';
import { initProjectMemory, buildProjectContext, getCurrentProject } from './memory/projects.js';
import { loadPreferences } from './memory/preferences.js';
import { discoverRecipes, loadRecipe, executeRecipe } from './recipes/engine.js';
import { startRecording, stopRecording, isRecording, saveRecipeToWorkspace } from './recipes/recorder.js';
import { WatchDaemon } from './watcher/daemon.js';
import { vaultExists, createVault, unlockVault, lockVault, isVaultUnlocked, setVaultEntry, getVaultEntry, deleteVaultEntry, listVaultEntries } from './vault/vault.js';
import { createProfile, loadProfile, listProfiles } from './sync/profiles.js';
import { renderDashboard, renderStatusBar, DashboardState } from './ui/dashboard.js';
import { classifyInput } from './repl/control-plane/classifier.js';
import { registerBuiltinCommands, searchPalette, renderPalette } from './repl/control-plane/palette.js';

// ─── v2.0 Watch Daemon Singleton ────────────────────────────────────────────
let _watchDaemon: WatchDaemon | null = null;
let _watchEventCount = 0;

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

async function renderAdvisorCard(filePath: string, scrubbedContent: string, diffText: string): Promise<void> {
  const advice = await getDriftAdvice(filePath, scrubbedContent, diffText);
  const width = 58;
  const top = `\x1b[1;35m╔${'═'.repeat(width - 2)}╗\x1b[0m`;
  const mid = `\x1b[1;35m╟${'─'.repeat(width - 2)}╢\x1b[0m`;
  const bot = `\x1b[1;35m╚${'═'.repeat(width - 2)}╝\x1b[0m`;

  const padRight = (text: string, w: number): string => {
    const visible = stripAnsi(text).length;
    const right = ' '.repeat(Math.max(0, w - visible));
    return text + right;
  };

  const title = `\x1b[1;35m║\x1b[1;33m${padRight('🤖 AI DRIFT ADVISORY', width - 2)}\x1b[1;35m║\x1b[0m`;
  
  const adviceLines = advice.split('\n').filter(Boolean);
  const formattedLines: string[] = [];
  const maxLen = width - 6;

  for (const line of adviceLines) {
    let remaining = line;
    while (remaining.length > 0) {
      let slice = remaining.substring(0, maxLen);
      if (remaining.length > maxLen) {
        const lastSpace = slice.lastIndexOf(' ');
        if (lastSpace > 10) {
          slice = slice.substring(0, lastSpace);
        }
      }
      remaining = remaining.substring(slice.length).trim();
      
      const visibleLength = stripAnsi(slice).length;
      const padRight = Math.max(0, maxLen - visibleLength);
      formattedLines.push(`\x1b[1;35m║\x1b[0m  \x1b[35m${slice}\x1b[0m${' '.repeat(padRight)}  \x1b[1;35m║\x1b[0m`);
    }
  }

  const card = [top, title, mid, ...formattedLines, bot].join('\n');
  console.log('\n' + centerBlock(card) + '\n');
}

export async function runWorkspaceResolve(workspaceRoot: string): Promise<void> {
  const drift = await detectWorkspaceDrift(workspaceRoot);
  const filesToResolve = drift.files.filter(f => f.status !== 'unmodified');
  if (filesToResolve.length === 0) {
    console.log(centerLine('\x1b[32m  ✓ No workspace drift detected. Everything is up to date!\x1b[0m\n', 54));
    return;
  }

  const manifest = await loadWorkspaceManifest(workspaceRoot);
  const rl = getReadlineInterface();

  for (const file of filesToResolve) {
    const header = `Found ${file.status} file: ${file.path}`;
    console.log('\n' + centerLine(`\x1b[1;36m${header}\x1b[0m`, header.length));

    if (file.status === 'modified') {
      try {
        const livePath = resolveLiveFilePath(workspaceRoot, file.path);
        const liveRaw = readFileSync(livePath, 'utf-8');
        const liveScrubbed = scrubContentGeneric(liveRaw);
        const trackedContent = await inspectTrackedFile(workspaceRoot, file.path);
        
        const diff = generateDiffPreview(trackedContent, liveScrubbed);
        console.log(centerLine(`\x1b[1;33mUnified Diff Preview (Scrubbed):\x1b[0m`, 32));
        console.log(centerBlock(diff));
        
        // Dynamically integrate advisor card right above decision prompt
        await renderAdvisorCard(file.path, liveScrubbed, diff);
        
        const prompt = centerPrompt(`\x1b[1;36mStage and track these changes for ${file.path}? [y/N] ❯ \x1b[0m`);
        const answer = await rl.question(prompt);
        if (answer.trim().toLowerCase() === 'y') {
          await stageToTracking(workspaceRoot, file.path);
          
          const stat = statSync(livePath);
          manifest.trackedPaths[file.path] = {
            hash: computeScrubbedHash(liveRaw),
            mode: stat.mode,
            mtime: stat.mtimeMs
          };
          await saveWorkspaceManifest(workspaceRoot, manifest);
          console.log(centerLine(`\x1b[32m  ✓ Staged and updated tracking for ${file.path}\x1b[0m`, file.path.length + 37));
        } else {
          console.log(centerLine(`\x1b[33m  Skipped ${file.path}\x1b[0m`, file.path.length + 10));
        }
      } catch (err: any) {
        console.error(centerLine(`\x1b[31m  Error resolving modified file ${file.path}: ${err.message}\x1b[0m`, file.path.length + err.message.length + 42));
      }
    } else if (file.status === 'untracked') {
      try {
        const livePath = resolveLiveFilePath(workspaceRoot, file.path);
        const liveRaw = readFileSync(livePath, 'utf-8');
        const liveScrubbed = scrubContentGeneric(liveRaw);
        
        console.log(centerLine(`\x1b[1;33mScrubbed Content Preview:\x1b[0m`, 25));
        console.log(centerBlock(liveScrubbed));
        
        // Dynamically integrate advisor card right above decision prompt
        await renderAdvisorCard(file.path, liveScrubbed, liveScrubbed);
        
        const prompt = centerPrompt(`\x1b[1;36mStart tracking untracked file ${file.path}? [y/N] ❯ \x1b[0m`);
        const answer = await rl.question(prompt);
        if (answer.trim().toLowerCase() === 'y') {
          await stageToTracking(workspaceRoot, file.path);
          
          const stat = statSync(livePath);
          manifest.trackedPaths[file.path] = {
            hash: computeScrubbedHash(liveRaw),
            mode: stat.mode,
            mtime: stat.mtimeMs
          };
          await saveWorkspaceManifest(workspaceRoot, manifest);
          console.log(centerLine(`\x1b[32m  ✓ Staged and started tracking for ${file.path}\x1b[0m`, file.path.length + 37));
        } else {
          console.log(centerLine(`\x1b[33m  Skipped ${file.path}\x1b[0m`, file.path.length + 10));
        }
      } catch (err: any) {
        console.error(centerLine(`\x1b[31m  Error resolving untracked file ${file.path}: ${err.message}\x1b[0m`, file.path.length + err.message.length + 43));
      }
    } else if (file.status === 'missing') {
      try {
        const prompt = centerPrompt(`\x1b[1;36mStop tracking missing file ${file.path}? [y/N] ❯ \x1b[0m`);
        const answer = await rl.question(prompt);
        if (answer.trim().toLowerCase() === 'y') {
          delete manifest.trackedPaths[file.path];
          await saveWorkspaceManifest(workspaceRoot, manifest);
          
          const trackingRoot = await getTrackingRoot();
          const targetFile = join(trackingRoot, file.path);
          if (existsSync(targetFile)) {
            unlinkSync(targetFile);
          }
          try {
            const { execFile: execFileCb } = await import('node:child_process');
            const { promisify } = await import('node:util');
            const execFile = promisify(execFileCb);
            await execFile('git', ['rm', file.path], { cwd: trackingRoot });
            await execFile('git', ['commit', '-m', `Tracked configuration removal: ${file.path}`], {
              cwd: trackingRoot,
              env: {
                ...process.env,
                GIT_AUTHOR_NAME: 'getit-agent',
                GIT_AUTHOR_EMAIL: 'getit@local',
                GIT_COMMITTER_NAME: 'getit-agent',
                GIT_COMMITTER_EMAIL: 'getit@local'
              }
            });
          } catch {}
          console.log(centerLine(`\x1b[32m  ✓ Stopped tracking and deleted mirror for ${file.path}\x1b[0m`, file.path.length + 47));
        } else {
          console.log(centerLine(`\x1b[33m  Skipped ${file.path}\x1b[0m`, file.path.length + 10));
        }
      } catch (err: any) {
        console.error(centerLine(`\x1b[31m  Error resolving missing file ${file.path}: ${err.message}\x1b[0m`, file.path.length + err.message.length + 41));
      }
    }
  }
  console.log('\n\x1b[32m✓ Interactive resolution complete!\x1b[0m\n');
}

async function bootstrap() {
  // 1. CLI Argument Parsing using native node:util parseArgs
  const options = {
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
    model: { type: 'string' },
    timeout: { type: 'string' },
    'allow-root': { type: 'boolean' },
    setup: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    profile: { type: 'string' }
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
  if (process.getuid && process.getuid() === 0 && !values['allow-root'] && process.env.GETIT_TEST_MODE !== 'true' && process.env.MOCK_TOOL_CALL !== 'true') {
    console.error('\x1b[1;31mError: Running getit as root is prohibited for safety.\x1b[0m');
    console.error('Please run as a standard user, or pass --allow-root to override.');
    process.exit(1);
  }

  // Initialize configurations and apply defaults/overrides
  const config = loadConfig();

  let activeProfile: PolicyProfile = config.profile;
  if (values.profile) {
    if (!['strict', 'normal', 'override'].includes(values.profile)) {
      console.error('\x1b[31mError: --profile must be one of strict, normal, override.\x1b[0m');
      process.exit(1);
    }
    activeProfile = values.profile as PolicyProfile;
  }
  configureRuntimeSession({ policyProfile: activeProfile });

  // v2.0: Register palette and initialize memory asynchronously (best-effort)
  try { registerBuiltinCommands(); } catch { /* palette is non-critical */ }
  initSessionMemory(process.cwd()).catch(() => { /* best-effort */ });
  initProjectMemory(process.cwd()).catch(() => { /* best-effort */ });
  loadPreferences().catch(() => { /* best-effort */ });

  // v2.0: Load plugins from project plugin dir (best-effort)
  try {
    const pluginDir = join(process.cwd(), '.getit', 'tools');
    if (existsSync(pluginDir)) {
      await initPluginRegistry(process.cwd());
    }
  } catch { /* plugins are non-critical */ }

  const isDryRun = values['dry-run'] !== undefined ? !!values['dry-run'] : config.dryRun;
  if (isDryRun) {
    configureRuntimeSession({ dryRun: true });
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

  if (positionals[0] === 'undo') {
    await runUndoCommand();
    closeReadlineInterface();
    process.exit(0);
  }

  if (positionals[0] === 'config') {
    printConfigCard();
    process.exit(0);
  }

  if (positionals[0] === 'doctor') {
    await runDoctorCli();
    process.exit(0);
  }

  if (positionals[0] === 'models') {
    await runModelsCli();
    process.exit(0);
  }

  const VALID_COMMANDS = ['undo', 'config', 'doctor', 'models', 'manifest', 'status', 'inspect', 'export', 'resolve', 'stage', 'history', 'log', 'rollback', 'run', 'watch', 'plugins', 'vault', 'sync', 'recipe'];
  if (positionals.length > 0 && !VALID_COMMANDS.includes(positionals[0])) {
    // Allow free-form prompts (anything not matching a command is a prompt)
    if (positionals.length > 1 || !VALID_COMMANDS.some(c => positionals[0].startsWith(c))) {
      // Fall through to one-shot mode below
    }
  }

  if (['manifest', 'status', 'inspect', 'export', 'resolve', 'stage', 'history', 'log', 'rollback'].includes(positionals[0])) {
    await handleWorkspaceCli(positionals, values);
  }

  // v2.0 CLI subcommands
  if (positionals[0] === 'run') {
    await handleRunCli(positionals.slice(1));
    closeReadlineInterface();
    process.exit(0);
  }

  if (positionals[0] === 'plugins') {
    await handlePluginsCli(positionals.slice(1));
    closeReadlineInterface();
    process.exit(0);
  }

  if (positionals[0] === 'vault') {
    await handleVaultCli(positionals.slice(1));
    closeReadlineInterface();
    process.exit(0);
  }

  if (positionals[0] === 'sync') {
    await handleSyncCli(positionals.slice(1));
    closeReadlineInterface();
    process.exit(0);
  }

  if (positionals[0] === 'watch') {
    await handleWatchCli();
    closeReadlineInterface();
    process.exit(0);
  }

  if (positionals[0] === 'recipe') {
    await handleRecipeCli(positionals.slice(1));
    closeReadlineInterface();
    process.exit(0);
  }

  if (values.model) {
    initSessionModel(values.model);
  } else {
    initSessionModel(config.model);
  }

  if (values.timeout) {
    const parsedTimeout = parseInt(values.timeout, 10);
    if (!isNaN(parsedTimeout) && parsedTimeout > 0) {
      setDefaultTimeout(parsedTimeout);
    } else {
      console.error('\x1b[31mError: Timeout must be a positive integer in milliseconds.\x1b[0m');
      process.exit(1);
    }
  } else {
    setDefaultTimeout(config.timeout);
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

  // 4. Load API Key — launch guided wizard if missing (keyless carriers skip)
  if (!config.apiKey && configRequiresApiKey(config)) {
    if (positionals.length > 0 || !process.stdout.isTTY) {
      console.error('\x1b[1;31mError: API key is not set.\x1b[0m');
      console.error(`Set one of: ${getApiKeyEnvHints(config.carrier)}`);
      console.error('Or run: getit --setup');
      process.exit(1);
    }
    await runSetupWizard();
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
      if (getRuntimeSession().dryRun) {
        await completeDryRunRoadmap();
      }
    } catch (err: any) {
      console.error(`\x1b[31mExecution Error: ${err.message}\x1b[0m`);
      process.exit(1);
    }
    closeReadlineInterface();
    process.exit(0);
  }

  // 9. Interactive REPL Loop
  // Draw Dashboard welcome banner
  const root = await findWorkspaceRoot(process.cwd());
  let workspaceBanner = '';
  if (root) {
    try {
      const manifest = await loadWorkspaceManifest(root);
      const count = Object.keys(manifest.trackedPaths).length;
      workspaceBanner = `│ \x1b[1;32mWorkspace:\x1b[0m TRACKED (\x1b[1;37m${count}\x1b[0m files) \x1b[1;36m                              │\n` +
                        `├────────────────────────────────────────────────────────┤\n`;
    } catch {
      workspaceBanner = '';
    }
  }

  let workspaceWarning = '';
  if (!root) {
    const anchors = ['package.json', 'Cargo.toml', 'pyproject.toml', 'go.mod', '.git'];
    let hasAnchors = false;
    let current = process.cwd();
    while (true) {
      if (anchors.some(anchor => existsSync(join(current, anchor)))) {
        hasAnchors = true;
        break;
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
    if (hasAnchors) {
      workspaceWarning = `│ \x1b[1;33mWorkspace: NOT INITIALIZED ⚠\x1b[0m                            \x1b[1;36m│\n` +
                         `│ \x1b[2mRun "getit manifest init" to track workspace.\x1b[0m           \x1b[1;36m│\n` +
                         `├────────────────────────────────────────────────────────┤\n`;
    }
  }

  const welcomeLines: string[] = [];
  welcomeLines.push(`\x1b[1;32m  ____      _   ___ _   \x1b[0m`);
  welcomeLines.push(`\x1b[1;32m / ___| ___| |_|_ _| |_ \x1b[0m`);
  welcomeLines.push(`\x1b[1;32m| |  _ / _ \\ __|| || __|\x1b[0m`);
  welcomeLines.push(`\x1b[1;32m| |_| |  __/ |_ | || |_ \x1b[0m`);
  welcomeLines.push(`\x1b[1;32m \\____|\\___|\\__|___|\\__|\x1b[0m`);
  welcomeLines.push(``);
  welcomeLines.push(`┌────────────────────────────────────────────────────────┐`);
  welcomeLines.push(`│ \x1b[1;32mGETIT WORKSPACE AGENT v${getVersion().padEnd(10)}\x1b[1;36m                         │`);
  welcomeLines.push(`├────────────────────────────────────────────────────────┤`);
  if (workspaceBanner) {
    welcomeLines.push(...workspaceBanner.trim().split('\n'));
  } else if (workspaceWarning) {
    welcomeLines.push(...workspaceWarning.trim().split('\n'));
  }
  welcomeLines.push(`│ \x1b[1;37mArchitecture:\x1b[0m  ${env.arch.padEnd(40)} \x1b[1;36m│`);
  welcomeLines.push(`│ \x1b[1;37mPlatform:\x1b[0m      ${env.osName.padEnd(40)} \x1b[1;36m│`);
  
  const deps = Object.entries(env.binaries)
    .map(([k, v]) => `${k}:${v ? '✓' : '✗'}`)
    .join(' ');
  welcomeLines.push(`│ \x1b[1;37mDependencies:\x1b[0m  ${deps.padEnd(40)} \x1b[1;36m│`);
  
  const pathStatus = env.localBinInPath ? 'Registered ✓' : 'NOT in PATH ✗';
  welcomeLines.push(`│ \x1b[1;37m~/.local/bin:\x1b[0m  ${pathStatus.padEnd(40)} \x1b[1;36m│`);

  const updateAvailable = await checkForUpdates();
  if (updateAvailable) {
    welcomeLines.push(`├────────────────────────────────────────────────────────┤`);
    welcomeLines.push(`│ \x1b[1;33m[!] Update Available! Run /update to install.\x1b[1;36m          │`);
  }

  welcomeLines.push(`└────────────────────────────────────────────────────────┘`);

  console.log('\n' + centerBlock(welcomeLines.join('\n')));
  console.log(centerLine('Type \x1b[1;33m/help\x1b[0m for available commands.', 38) + '\n');

  const rl = getReadlineInterface();

  // Handle Ctrl+C (SIGINT) cleanly
  rl.on('SIGINT', () => {
    console.log('\n\x1b[33m[getit] Session terminated via Ctrl+C. Exiting cleanly.\x1b[0m');
    closeReadlineInterface();
    process.exit(0);
  });

  // Handle standard 'exit' command or EOF (Ctrl+D)
  while (true) {
    const promptString = centerPrompt('getit-agent ❯ ');
    
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
      if (getRuntimeSession().dryRun) {
        await completeDryRunRoadmap();
      }

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
    case '/update': {
      try {
        await performUpdate();
        console.log(`\n\x1b[32m✓ Update completed successfully. Please restart getit.\x1b[0m\n`);
      } catch (err: any) {
        console.error(`\x1b[31m  Update Error: ${err.message}\x1b[0m`);
      }
      return 'exit';
    }
    case '/undo':
      await runUndoCommand();
      return;
    case '/dry-run':
      if (arg === 'on') {
        configureRuntimeSession({ dryRun: true });
        console.log('\x1b[32m  Dry-run mode enabled.\x1b[0m');
      } else if (arg === 'off') {
        configureRuntimeSession({ dryRun: false });
        console.log('\x1b[32m  Dry-run mode disabled.\x1b[0m');
      } else {
        console.log(`  Dry-run mode: \x1b[1;37m${getRuntimeSession().dryRun ? 'on' : 'off'}\x1b[0m`);
      }
      return;
    case '/policy':
      console.log(`\n  Policy Profile: \x1b[1;37m${getRuntimeSession().policyProfile}\x1b[0m\n`);
      return;
    case '/config':
      printConfigCard();
      return;
    case '/carrier': {
      if (!arg) {
        const cfg = loadConfig();
        const preset = resolveActivePreset(cfg.carrier, cfg.baseUrl);
        console.log(`\n  Carrier: \x1b[1;37m${preset.displayName}\x1b[0m (${cfg.carrier})`);
        console.log(`  Base URL: \x1b[1;37m${cfg.baseUrl}\x1b[0m`);
        console.log('  Switch: \x1b[1;33m/carrier <id>\x1b[0m  e.g. groq, openai, ollama\n');
        return;
      }
      const id = normalizeCarrierId(arg);
      switchCarrier(id);
      const updated = loadConfig();
      const preset = resolveActivePreset(updated.carrier, updated.baseUrl);
      setActiveModel(updated.model);
      console.log(`\x1b[32m  Carrier switched to ${preset.displayName} (${updated.baseUrl})\x1b[0m\n`);
      return;
    }
    case '/models': {
      const cfg = loadConfig();
      const preset = resolveActivePreset(cfg.carrier, cfg.baseUrl);
      console.log(`\n\x1b[1;36m  Models for ${preset.displayName}:\x1b[0m\n`);
      const models = await listModels(preset, cfg.apiKey, { forceRefresh: arg === 'refresh' });
      console.log(centerBlock(formatModelList(models, 25)) + '\n');
      return;
    }
    case '/status': {
      try {
        const wsRoot = await findWorkspaceRoot(process.cwd());
        if (!wsRoot) {
          console.log('\x1b[31m  Error: No active workspace. Run "getit manifest init" first.\x1b[0m\n');
          return;
        }
        const drift = await detectWorkspaceDrift(wsRoot);
        const statusLines: string[] = [];
        statusLines.push(`\x1b[1;36mWorkspace Offline Drift Status:\x1b[0m`);
        statusLines.push(`Active Workspace Root: \x1b[1;37m${wsRoot}\x1b[0m\n`);
        
        if (drift.files.length === 0) {
          statusLines.push(`\x1b[33mNo candidate config files detected. Run "getit manifest init" to initialize.\x1b[0m\n`);
        } else {
          statusLines.push(`\x1b[1;37mStatus     Path\x1b[0m`);
          statusLines.push(`────────── ───────────────────────────────────────────────────`);
          for (const file of drift.files) {
            let statusColor = '\x1b[37m';
            if (file.status === 'modified') statusColor = '\x1b[1;31m';
            else if (file.status === 'missing') statusColor = '\x1b[31m';
            else if (file.status === 'untracked') statusColor = '\x1b[1;33m';
            else if (file.status === 'unmodified') statusColor = '\x1b[32m';

            statusLines.push(`${statusColor}${file.status.padEnd(10)}\x1b[0m ${file.path}`);
          }
        }
        console.log('\n' + centerBlock(statusLines.join('\n')) + '\n');
      } catch (err: any) {
        console.log(centerLine(`\x1b[31mError: ${err.message}\x1b[0m`, err.message.length + 7));
      }
      return;
    }
    case '/stage':
    case '/resolve': {
      try {
        const workspaceRoot = await findWorkspaceRoot(process.cwd());
        if (!workspaceRoot) {
          console.log('\x1b[31m  Error: No active workspace found. Please initialize workspace tracking using "getit manifest init" first.\x1b[0m\n');
        } else {
          await runWorkspaceResolve(workspaceRoot);
        }
      } catch (err: any) {
        console.log(`\x1b[31m  Error: ${err.message}\x1b[0m`);
      }
      return;
    }
    case '/export': {
      try {
        const wsRoot = await findWorkspaceRoot(process.cwd());
        if (!wsRoot) {
          console.log('\x1b[31m  Error: No active workspace. Run "getit manifest init" first.\x1b[0m\n');
          return;
        }
        const result = await exportScrubbedWorkspace(wsRoot, arg || undefined);
        console.log(`\x1b[32m  ✓ Exported ${result.filesExported.length} scrubbed file(s) to:\x1b[0m`);
        console.log(`  \x1b[1;37m${result.outputDir}\x1b[0m\n`);
      } catch (err: any) {
        console.log(`\x1b[31m  Error: ${err.message}\x1b[0m\n`);
      }
      return;
    }
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
    case '/log':
    case '/history': {
      const commits = await WorkspaceHistoryManager.getHistory();
      const card = WorkspaceHistoryManager.renderHistory(commits);
      console.log('\n' + card + '\n');
      return;
    }
    case '/rollback': {
      if (!arg) {
        console.log(`\x1b[31m  Error: Missing commit hash. Usage: /rollback <commit-hash> [file]\x1b[0m`);
        return;
      }
      const parts = arg.trim().split(/\s+/);
      const commitHash = parts[0];
      const fileArg = parts[1];
      try {
        const diff = await WorkspaceRollbackManager.previewRollback(commitHash, fileArg);
        console.log('\n' + centerLine(`\x1b[1;33mUnified Diff Preview (Scrubbed):\x1b[0m`, 32));
        console.log(centerBlock(diff));
        
        await WorkspaceRollbackManager.executeRollback(commitHash, fileArg);
      } catch (err: any) {
        console.log(`\x1b[31m  Error during rollback: ${err.message}\x1b[0m`);
      }
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

    // ─── v2.0 Commands ────────────────────────────────────────────────────────

    case '/plugins': {
      const subcmd = arg.split(/\s+/)[0];
      const subarg = arg.split(/\s+/).slice(1).join(' ');
      if (subcmd === 'reload') {
        try {
          const pluginDir = join(process.cwd(), '.getit', 'tools');
          if (existsSync(pluginDir)) {
            await reloadPlugins(process.cwd());
          }
          console.log(`\x1b[32m  ✓ Plugins reloaded: ${getAllPlugins().length} loaded.\x1b[0m`);
        } catch (e: any) {
          console.log(`  \x1b[31mPlugin reload error: ${e.message}\x1b[0m`);
        }
      } else if (subcmd === 'info' && subarg) {
        const p = getPlugin(subarg);
        if (!p) {
          console.log(`  \x1b[31mPlugin "${subarg}" not found.\x1b[0m`);
        } else {
          console.log(`\n  \x1b[1;36m${p.name}\x1b[0m  [risk: ${p.risk}]`);
          console.log(`  ${p.description}\n`);
        }
      } else {
        const all = getAllPlugins();
        if (all.length === 0) {
          console.log('\n  \x1b[2mNo plugins loaded. Place .js plugin files in .getit/tools/\x1b[0m\n');
        } else {
          console.log(`\n  \x1b[1;36mLoaded Plugins (${all.length}):\x1b[0m`);
          for (const p of all) {
            const riskColor = p.risk === 'system' ? '\x1b[31m' : p.risk === 'write' ? '\x1b[33m' : '\x1b[32m';
            console.log(`  ${riskColor}[${p.risk}]\x1b[0m \x1b[1;37m${p.name}\x1b[0m — ${p.description}`);
          }
          console.log('');
        }
        console.log('  \x1b[2m/plugins reload    /plugins info <name>\x1b[0m\n');
      }
      return;
    }

    case '/memory': {
      const subcmd = arg.split(/\s+/)[0];
      if (subcmd === 'clear') {
        console.log('  \x1b[2m(Session memory is reset on restart)\x1b[0m\n');
      } else {
        const ctx = buildSessionContext();
        if (!ctx) {
          console.log('\n  \x1b[2mNo session memory entries yet.\x1b[0m\n');
        } else {
          console.log('\n' + ctx + '\n');
        }
        const proj = buildProjectContext();
        if (proj) {
          console.log(proj + '\n');
        }
      }
      return;
    }

    case '/context': {
      const proj = buildProjectContext();
      const sess = buildSessionContext();
      if (!proj && !sess) {
        console.log('\n  \x1b[2mNo context available yet.\x1b[0m\n');
      } else {
        if (proj) console.log('\n' + proj);
        if (sess) console.log('\n' + sess);
        console.log('');
      }
      return;
    }

    case '/recipe':
    case '/recipes': {
      const subcmd = arg.split(/\s+/)[0];
      const subarg = arg.split(/\s+/).slice(1).join(' ');
      if (!subcmd || subcmd === 'list') {
        try {
          const recipes = await discoverRecipes(process.cwd());
          if (recipes.length === 0) {
            console.log('\n  \x1b[2mNo recipes found in .getit/recipes/\x1b[0m\n');
          } else {
            console.log(`\n  \x1b[1;36mAvailable Recipes (${recipes.length}):\x1b[0m`);
            for (const r of recipes) {
              console.log(`  \x1b[1;37m${r.name}\x1b[0m [${r.source}]`);
            }
            console.log('');
          }
        } catch (e: any) {
          console.log(`  \x1b[31mError listing recipes: ${e.message}\x1b[0m\n`);
        }
      } else if (subcmd === 'run' && subarg) {
        try {
          const recipesDir = join(process.cwd(), '.getit', 'recipes');
          const recipeFile = join(recipesDir, subarg.endsWith('.yaml') ? subarg : `${subarg}.yaml`);
          const recipe = await loadRecipe(recipeFile);
          let i = 0;
          await executeRecipe(recipe, {}, {
            onStepStart: (step) => {
              i++;
              console.log(`  \x1b[2mStep ${i}: ${step.tool}(${JSON.stringify(step.args)})\x1b[0m`);
            }
          });
          console.log(`  \x1b[32m✓ Recipe "${recipe.name}" completed.\x1b[0m\n`);
        } catch (e: any) {
          console.log(`  \x1b[31mRecipe error: ${e.message}\x1b[0m\n`);
        }
      } else if (subcmd === 'create') {
        console.log('  \x1b[2mCreate recipe template in .getit/recipes/<name>.yaml\x1b[0m\n');
        console.log('  \x1b[2mSee docs for recipe YAML format.\x1b[0m\n');
      } else if (subcmd === 'save' && subarg) {
        if (!isRecording()) {
          console.log('  \x1b[31mNot currently recording. Use /recipe record first.\x1b[0m\n');
        } else {
          try {
            const saved = stopRecording();
            if (saved) {
              saved.name = subarg;
              await saveRecipeToWorkspace(saved, process.cwd());
              console.log(`  \x1b[32m✓ Recipe saved as "${saved.name}" with ${saved.steps.length} step(s).\x1b[0m\n`);
            }
          } catch (e: any) {
            console.log(`  \x1b[31mSave error: ${e.message}\x1b[0m\n`);
          }
        }
      } else if (subcmd === 'record') {
        startRecording('new_recipe', 'Recorded recipe');
        console.log('  \x1b[32m● Recording started. Use /recipe save <name> to save.\x1b[0m\n');
      } else {
        console.log('  Usage: /recipes list | run <name> | record | save <name> | create\n');
      }
      return;
    }

    case '/watch': {
      const subcmd = arg.split(/\s+/)[0];
      if (subcmd === 'start' || !subcmd) {
        if (_watchDaemon?.isRunning()) {
          console.log('  \x1b[33mWatch mode already active.\x1b[0m\n');
        } else {
          _watchDaemon = new WatchDaemon(process.cwd());
          _watchDaemon.on('change', (event) => {
            _watchEventCount++;
            process.stdout.write(`\r\x1b[36m[watch]\x1b[0m ${event.type}: ${event.relativePath}\n`);
          });
          await _watchDaemon.start();
          console.log('  \x1b[32m● Watch mode started.\x1b[0m\n');
        }
      } else if (subcmd === 'stop') {
        if (_watchDaemon?.isRunning()) {
          _watchDaemon.stop();
          console.log('  \x1b[33m○ Watch mode stopped.\x1b[0m\n');
        } else {
          console.log('  \x1b[2mWatch mode not running.\x1b[0m\n');
        }
      } else if (subcmd === 'status') {
        const running = _watchDaemon?.isRunning() ?? false;
        console.log(`\n  Watch Mode:  \x1b[1;37m${running ? '\x1b[32mactive' : '\x1b[2minactive'}\x1b[0m`);
        console.log(`  Events seen: \x1b[1;37m${_watchEventCount}\x1b[0m\n`);
      } else {
        console.log('  Usage: /watch [start|stop|status]\n');
      }
      return;
    }

    case '/dashboard': {
      const state: DashboardState = {
        sessionActive: true,
        model: getActiveModel(),
        carrier: loadConfig().carrier,
        watchActive: _watchDaemon?.isRunning() ?? false,
        watchEvents: _watchEventCount,
        pluginsLoaded: getAllPlugins().length,
        memoryEntries: 0,
        recipeCount: 0,
        dryRunActive: getRuntimeSession().dryRun,
        policyProfile: getRuntimeSession().policyProfile,
        vaultUnlocked: isVaultUnlocked(),
        recentActions: []
      };
      console.log('\n' + centerBlock(renderDashboard(state)) + '\n');
      return;
    }

    case '/vault': {
      const subcmd = arg.split(/\s+/)[0];
      const subarg = arg.split(/\s+/).slice(1).join(' ');

      if (!subcmd || subcmd === 'status') {
        const exists = await vaultExists();
        if (!exists) {
          console.log('\n  \x1b[2mNo vault found. Run /vault init to create one.\x1b[0m\n');
        } else {
          const locked = isVaultUnlocked() ? '\x1b[32m🔓 Unlocked\x1b[0m' : '\x1b[33m🔒 Locked\x1b[0m';
          const entries = isVaultUnlocked() ? listVaultEntries() : [];
          console.log(`\n  Vault: ${locked}`);
          if (isVaultUnlocked()) {
            console.log(`  Entries: \x1b[1;37m${entries.length}\x1b[0m`);
          }
          console.log('');
        }
      } else if (subcmd === 'init') {
        try {
          const rl = getReadlineInterface();
          const pass = await rl.question('  \x1b[1;36mNew vault passphrase: \x1b[0m');
          await createVault(pass);
          console.log('  \x1b[32m✓ Vault created and unlocked.\x1b[0m\n');
        } catch (e: any) {
          console.log(`  \x1b[31mVault creation error: ${e.message}\x1b[0m\n`);
        }
      } else if (subcmd === 'unlock') {
        try {
          const rl = getReadlineInterface();
          const pass = await rl.question('  \x1b[1;36mVault passphrase: \x1b[0m');
          await unlockVault(pass);
          console.log('  \x1b[32m✓ Vault unlocked.\x1b[0m\n');
        } catch (e: any) {
          console.log(`  \x1b[31mVault unlock failed: ${e.message}\x1b[0m\n`);
        }
      } else if (subcmd === 'lock') {
        lockVault();
        console.log('  \x1b[33m🔒 Vault locked.\x1b[0m\n');
      } else if (subcmd === 'get' && subarg) {
        if (!isVaultUnlocked()) { console.log('  \x1b[31mVault is locked.\x1b[0m\n'); return; }
        const entry = getVaultEntry(subarg);
        if (!entry) {
          console.log(`  \x1b[31mNo entry found for key "${subarg}".\x1b[0m\n`);
        } else {
          console.log(`  \x1b[1;37m${entry.key}\x1b[0m [${entry.category}] = \x1b[32m${entry.value}\x1b[0m\n`);
        }
      } else if (subcmd === 'set') {
        if (!isVaultUnlocked()) { console.log('  \x1b[31mVault is locked.\x1b[0m\n'); return; }
        const [key, ...valParts] = subarg.split(/\s+/);
        const value = valParts.join(' ');
        if (!key || !value) { console.log('  Usage: /vault set <key> <value>\n'); return; }
        await setVaultEntry(key, value);
        console.log(`  \x1b[32m✓ Entry "${key}" saved.\x1b[0m\n`);
      } else if (subcmd === 'delete') {
        if (!isVaultUnlocked()) { console.log('  \x1b[31mVault is locked.\x1b[0m\n'); return; }
        const deleted = await deleteVaultEntry(subarg);
        console.log(deleted ? `  \x1b[32m✓ Entry "${subarg}" deleted.\x1b[0m\n` : `  \x1b[31mEntry not found.\x1b[0m\n`);
      } else if (subcmd === 'list') {
        if (!isVaultUnlocked()) { console.log('  \x1b[31mVault is locked.\x1b[0m\n'); return; }
        const entries = listVaultEntries();
        if (entries.length === 0) {
          console.log('  \x1b[2m(no entries)\x1b[0m\n');
        } else {
          for (const e of entries) {
            console.log(`  \x1b[36m[${e.category}]\x1b[0m \x1b[1;37m${e.key}\x1b[0m  \x1b[2m${e.lastModified}\x1b[0m`);
          }
          console.log('');
        }
      } else {
        console.log('  Usage: /vault [status|init|unlock|lock|get <key>|set <key> <val>|delete <key>|list]\n');
      }
      return;
    }

    case '/sync': {
      const subcmd = arg.split(/\s+/)[0];
      const subarg = arg.split(/\s+/).slice(1).join(' ');
      if (!subcmd || subcmd === 'status') {
        const profiles = await listProfiles().catch(() => []);
        console.log(`\n  Sync Profiles: \x1b[1;37m${profiles.length}\x1b[0m`);
        for (const p of profiles) {
          console.log(`  \x1b[36m${p.name}\x1b[0m (machine: ${p.machine}) — ${p.createdAt.slice(0, 10)}`);
        }
        console.log('');
      } else if (subcmd === 'push') {
        const name = subarg || 'default';
        const cfg = loadConfig();
        const preset = resolveActivePreset(cfg.carrier, cfg.baseUrl);
        await createProfile(name, {
          carrierId: cfg.carrier,
          model: getActiveModel(),
          baseUrl: cfg.baseUrl,
          timeout: getDefaultTimeout()
        });
        console.log(`  \x1b[32m✓ Profile "${name}" saved.\x1b[0m\n`);
      } else if (subcmd === 'pull') {
        const name = subarg || 'default';
        const profile = await loadProfile(name);
        if (!profile) {
          console.log(`  \x1b[31mProfile "${name}" not found.\x1b[0m\n`);
        } else {
          if (profile.carrier.model) setActiveModel(profile.carrier.model);
          console.log(`  \x1b[32m✓ Profile "${name}" loaded (model: ${profile.carrier.model}).\x1b[0m\n`);
        }
      } else {
        console.log('  Usage: /sync [status|push [name]|pull [name]]\n');
      }
      return;
    }

    case '/palette': {
      const results = searchPalette(arg, 20);
      console.log('\n' + centerBlock(renderPalette(results, arg)) + '\n');
      return;
    }

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
  --dry-run             Queue native tool calls into a roadmap before executing mutations.
  --profile <name>      Set policy profile: strict, normal, or override.
  --allow-root          Override safety check blocking root execution.
  --setup               Launch interactive key setup wizard and exit.

Examples:
  $ getit                        # Launch full interactive multi-turn REPL
  $ getit install ripgrep        # Run command one-shot and exit
  $ getit --dry-run install rg   # Show and approve a roadmap before running
  $ getit undo                   # Restore the latest restorable transaction
  $ getit config                 # Show active carrier, model, and runtime options
  $ getit doctor                 # Health check: carrier connectivity, git
  $ getit models                 # List models for the active carrier
  $ getit manifest init          # Initialize active local workspace
  $ getit status                 # Check offline workspace configuration drift
  $ getit resolve                # Interactively resolve workspace configuration drift
  $ getit inspect .env           # Inspect credential-redacted tracking copy of config
  $ getit export [dir]         # Export scrubbed mirror of all tracked files
  $ getit --model qwen/qwen3-coder:free
  `);
}

function printConfigCard(): void {
  const currentConfig = loadConfig();
  const preset = resolveActivePreset(currentConfig.carrier, currentConfig.baseUrl);
  const configCardLines = [
    `Carrier:         \x1b[1;37m${preset.displayName}\x1b[0m (${currentConfig.carrier})`,
    `Base API URL:    \x1b[1;37m${currentConfig.baseUrl}\x1b[0m`,
    `Tool Calling:    \x1b[1;37m${preset.supportsTools ? 'supported' : 'limited'}\x1b[0m`,
    `Active Model:    \x1b[1;37m${getActiveModel()}\x1b[0m`,
    `Exec Timeout:    \x1b[1;37m${getDefaultTimeout()}ms\x1b[0m`,
    `Safety Profile:  \x1b[1;37m${getRuntimeSession().policyProfile}\x1b[0m`,
    `Dry-Run Mode:    \x1b[1;37m${getRuntimeSession().dryRun ? 'enabled' : 'disabled'}\x1b[0m`,
    `API Key:         \x1b[1;37m${currentConfig.apiKey ? '[CONFIGURED]' : preset.auth === 'none' ? '[NOT REQUIRED]' : '[MISSING]'}\x1b[0m`,
  ];

  const width = 58;
  const top = `\x1b[1;36m╔${'═'.repeat(width - 2)}╗\x1b[0m`;
  const mid = `\x1b[1;36m╟${'─'.repeat(width - 2)}╢\x1b[0m`;
  const bot = `\x1b[1;36m╚${'═'.repeat(width - 2)}╝\x1b[0m`;

  const padRight = (text: string, w: number): string => {
    const visible = stripAnsi(text).length;
    const right = ' '.repeat(Math.max(0, w - visible));
    return text + right;
  };

  const title = `\x1b[1;36m║\x1b[1;33m${padRight('CURRENT RUNTIME OPTIONS', width - 2)}\x1b[1;36m║\x1b[0m`;
  const formattedLines = configCardLines.map((line) => {
    const visibleLength = stripAnsi(line).length;
    const padRight = Math.max(0, (width - 6) - visibleLength);
    return `\x1b[1;36m║\x1b[0m  ${line}${' '.repeat(padRight)}  \x1b[1;36m║\x1b[0m`;
  });
  console.log('\n' + centerBlock([top, title, mid, ...formattedLines, bot].join('\n')) + '\n');
}

async function runDoctorCli(): Promise<void> {
  console.log('\n\x1b[1;36m  Running getit doctor...\x1b[0m\n');
  await runDoctorChecks();
  console.log('');
}

async function runModelsCli(): Promise<void> {
  const cfg = loadConfig();
  const preset = resolveActivePreset(cfg.carrier, cfg.baseUrl);
  console.log(`\n\x1b[1;36m  Models for ${preset.displayName}:\x1b[0m\n`);
  const models = await listModels(preset, cfg.apiKey, { forceRefresh: true });
  console.log(formatModelList(models, 30));
  console.log('');
}

function printHelp(): void {
  const helpBlock = [
    '┌────────────────────────────────────────────────────────┐',
    '│ \x1b[1;33mAVAILABLE COMMANDS\x1b[1;36m                                     │',
    '├────────────────────────────────────────────────────────┤',
    '│\x1b[0m                                                        \x1b[1;36m│',
    '│\x1b[0m  \x1b[1;37m/help\x1b[0m        Show this help menu                      \x1b[1;36m│',
    '│\x1b[0m  \x1b[1;37m/exit\x1b[0m        Exit the agent session                   \x1b[1;36m│',
    '│\x1b[0m  \x1b[1;37m/quit\x1b[0m        Alias for /exit                          \x1b[1;36m│',
    '│\x1b[0m  \x1b[1;37m/clear\x1b[0m       Clear the terminal screen                \x1b[1;36m│',
    '│\x1b[0m  \x1b[1;37m/env\x1b[0m         Display discovered environment info      \x1b[1;36m│',
    '│\x1b[0m  \x1b[1;37m/reset\x1b[0m       Clear conversation context starting fresh\x1b[1;36m│',
    '│\x1b[0m  \x1b[1;37m/cd <path>\x1b[0m   Change stateful working directory        \x1b[1;36m│',
    '│\x1b[0m  \x1b[1;37m/history\x1b[0m     Display shadow Git tracking history      \x1b[1;36m│',
    '│\x1b[0m  \x1b[1;37m/rollback\x1b[0m    Roll back workspace to past commit       \x1b[1;36m│',
    '│\x1b[0m  \x1b[1;37m/carrier\x1b[0m     Show or switch LLM provider             \x1b[1;36m│',
    '│\x1b[0m  \x1b[1;37m/models\x1b[0m      List models for active carrier          \x1b[1;36m│',
    '│\x1b[0m  \x1b[1;37m/model\x1b[0m       Display or override the session model    \x1b[1;36m│',
    '│\x1b[0m  \x1b[1;37m/setup\x1b[0m       Interactive guided API key configuration \x1b[1;36m│',
    '│\x1b[0m  \x1b[1;37m/undo\x1b[0m        Restore latest restorable transaction     \x1b[1;36m│',
    '│\x1b[0m  \x1b[1;37m/dry-run\x1b[0m     Show or toggle dry-run mode               \x1b[1;36m│',
    '│\x1b[0m  \x1b[1;37m/policy\x1b[0m      Display active policy profile             \x1b[1;36m│',
    '│\x1b[0m  \x1b[1;37m/config\x1b[0m      Display current runtime options           \x1b[1;36m│',
    '│\x1b[0m  \x1b[1;37m/status\x1b[0m      Display workspace drift status            \x1b[1;36m│',
    '│\x1b[0m  \x1b[1;37m/resolve\x1b[0m     Interactively resolve workspace drift    \x1b[1;36m│',
    '│\x1b[0m  \x1b[1;37m/export\x1b[0m      Export scrubbed copy of tracked files  \x1b[1;36m│',
    '│\x1b[0m                                                        \x1b[1;36m│',
    '│\x1b[0m  \x1b[2mYou can also type "exit" or press Ctrl+C to quit.\x1b[0m      \x1b[1;36m│',
    '│\x1b[0m  \x1b[2mAnything else is sent as a prompt to the AI agent.\x1b[0m     \x1b[1;36m│',
    '│\x1b[0m                                                        \x1b[1;36m│',
    '└────────────────────────────────────────────────────────┘'
  ].join('\n');

  console.log('\n' + centerBlock(helpBlock) + '\n');
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
  const cfg = loadConfig();
  const keyStatus = cfg.apiKey ? '\x1b[32mConfigured ✓\x1b[0m' : '\x1b[31mMissing ✗\x1b[0m';
  console.log(`  API Key:        ${keyStatus}`);
  console.log(`  Carrier:        \x1b[1;37m${cfg.carrier}\x1b[0m`);
  console.log(`  Active Model:   \x1b[1;37m${getActiveModel()}\x1b[0m`);
  console.log(`  Exec Timeout:   \x1b[1;37m${getDefaultTimeout()}ms\x1b[0m`);
  console.log(`  Stateful CWD:   \x1b[1;37m${getActiveCwd()}\x1b[0m`);
  console.log(`  Policy Profile: \x1b[1;37m${getRuntimeSession().policyProfile}\x1b[0m`);
  console.log(`  Dry Run:        \x1b[1;37m${getRuntimeSession().dryRun ? 'on' : 'off'}\x1b[0m`);
  console.log('');
}

function printGoodbye(): void {
  console.log('\x1b[33m[getit] Goodbye!\x1b[0m');
}

async function completeDryRunRoadmap(): Promise<void> {
  const session = getRuntimeSession();
  const roadmap = renderRoadmap(session.planQueue);
  console.log(`\n${roadmap}\n`);
  const mutations = session.planQueue.mutations();
  if (mutations.length === 0) return;

  const rl = getReadlineInterface();
  const answer = await rl.question('\x1b[1;36mProceed with executing all planned mutations? [y/N] ❯ \x1b[0m');
  if (answer.trim().toLowerCase() !== 'y') {
    console.log('\x1b[33m[getit] Dry-run roadmap rejected. No changes were made.\x1b[0m');
    return;
  }

  configureRuntimeSession({ dryRun: false });
  for (const call of mutations) {
    const result = await executePlannedCall(call);
    if (result.haltTurn) {
      console.log('\x1b[1;31m[getit] Planned execution halted after a failed action.\x1b[0m');
      break;
    }
  }
}

async function runUndoCommand(): Promise<void> {
  const result = await undoLatestTransaction({
    confirmMixed: async () => {
      const rl = getReadlineInterface();
      const answer = await rl.question('\x1b[1;36mProceed with restoring file changes? [y/N] ❯ \x1b[0m');
      return answer.trim().toLowerCase() === 'y';
    }
  });
  console.log(result.success ? `\x1b[32m${result.message}\x1b[0m` : `\x1b[31m${result.message}\x1b[0m`);
}

// ─── Workspace CLI Commands Helper ─────────────────────────────────────────────

async function handleWorkspaceCli(positionals: string[], values: any) {
  const cmd = positionals[0];
  const sub = positionals[1];

  if (cmd === 'manifest') {
    if (sub === 'init') {
      try {
        const manifest = await initWorkspaceManifest(process.cwd());
        console.log(`\n\x1b[32m✓ Workspace successfully initialized!\x1b[0m`);
        console.log(`  Fingerprint:  \x1b[1;37m${manifest.fingerprint}\x1b[0m`);
        console.log(`  Platform:     \x1b[1;37m${manifest.platform}\x1b[0m`);
        console.log(`  Arch:         \x1b[1;37m${manifest.arch}\x1b[0m`);
        console.log(`  Tracked:      \x1b[1;37m${Object.keys(manifest.trackedPaths).length} files\x1b[0m\n`);
        process.exit(0);
      } catch (err: any) {
        console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
        process.exit(1);
      }
    } else {
      console.error(`\x1b[31mError: Unknown manifest subcommand "${sub}". Mapped: init\x1b[0m`);
      process.exit(1);
    }
  }

  if (cmd === 'status') {
    try {
      const wsRoot = await findWorkspaceRoot(process.cwd());
      if (!wsRoot) {
        console.error(`\x1b[31mError: No active workspace found. Run "getit manifest init" first.\x1b[0m`);
        process.exit(1);
      }
      const drift = await detectWorkspaceDrift(wsRoot);
      console.log(`\n\x1b[1;36m  Workspace Offline Drift Status:\x1b[0m`);
      console.log(`  Active Workspace Root: \x1b[1;37m${wsRoot}\x1b[0m\n`);
      
      if (drift.files.length === 0) {
        console.log(`  \x1b[33mNo candidate config files detected. Run "getit manifest init" to initialize.\x1b[0m\n`);
      } else {
        console.log(`  \x1b[1;37mStatus     Path\x1b[0m`);
        console.log(`  ────────── ───────────────────────────────────────────────────`);
        for (const file of drift.files) {
          let statusColor = '\x1b[37m';
          if (file.status === 'modified') statusColor = '\x1b[1;31m';
          else if (file.status === 'missing') statusColor = '\x1b[31m';
          else if (file.status === 'untracked') statusColor = '\x1b[1;33m';
          else if (file.status === 'unmodified') statusColor = '\x1b[32m';

          console.log(`  ${statusColor}${file.status.padEnd(10)}\x1b[0m ${file.path}`);
        }
        console.log('');
      }

      process.exit(0);
    } catch (err: any) {
      console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
      process.exit(1);
    }
  }

  if (cmd === 'export') {
    const outputDir = positionals[1];
    try {
      const wsRoot = await findWorkspaceRoot(process.cwd());
      if (!wsRoot) {
        console.error(`\x1b[31mError: No active workspace found. Run "getit manifest init" first.\x1b[0m`);
        process.exit(1);
      }
      const result = await exportScrubbedWorkspace(wsRoot, outputDir);
      console.log(`\n\x1b[32m✓ Exported ${result.filesExported.length} scrubbed file(s)\x1b[0m`);
      console.log(`  Output: \x1b[1;37m${result.outputDir}\x1b[0m\n`);
      process.exit(0);
    } catch (err: any) {
      console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
      process.exit(1);
    }
  }

  if (cmd === 'inspect') {
    const file = positionals[1];
    if (!file) {
      console.error(`\x1b[31mError: Missing file argument. Usage: getit inspect <file_path>\x1b[0m`);
      process.exit(1);
    }
    try {
      const content = await inspectTrackedFile(process.cwd(), file);
      console.log(`\n\x1b[1;36m--- Inspecting Scrubbed Tracking Mirror: ${file} ---\x1b[0m\n`);
      console.log(content);
      console.log(`\n\x1b[1;36m---------------------------------------------------\x1b[0m\n`);
      process.exit(0);
    } catch (err: any) {
      console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
      process.exit(1);
    }
  }

  if (cmd === 'resolve' || cmd === 'stage') {
    try {
      const workspaceRoot = await findWorkspaceRoot(process.cwd());
      if (!workspaceRoot) {
        console.error(`\x1b[31mError: No active workspace found. Please initialize workspace tracking using "getit manifest init" first.\x1b[0m`);
        process.exit(1);
      }
      await runWorkspaceResolve(workspaceRoot);
      closeReadlineInterface();
      process.exit(0);
    } catch (err: any) {
      console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
      process.exit(1);
    }
  }

  if (cmd === 'history' || cmd === 'log') {
    try {
      const commits = await WorkspaceHistoryManager.getHistory();
      const card = WorkspaceHistoryManager.renderHistory(commits);
      console.log('\n' + card + '\n');
      process.exit(0);
    } catch (err: any) {
      console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
      process.exit(1);
    }
  }

  if (cmd === 'rollback') {
    const commitHash = positionals[1];
    const fileArg = positionals[2];
    if (!commitHash) {
      console.error(`\x1b[31mError: Missing commit hash. Usage: getit rollback <commit-hash> [file]\x1b[0m`);
      process.exit(1);
    }
    try {
      const diff = await WorkspaceRollbackManager.previewRollback(commitHash, fileArg);
      console.log('\n' + centerLine(`\x1b[1;33mUnified Diff Preview (Scrubbed):\x1b[0m`, 32));
      console.log(centerBlock(diff));

      await WorkspaceRollbackManager.executeRollback(commitHash, fileArg);
      process.exit(0);
    } catch (err: any) {
      console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
      process.exit(1);
    }
  }
}
// ─── v2.0 CLI Command Handlers ──────────────────────────────────────────────────

async function handleRunCli(args: string[]) {
  if (args.length === 0) {
    console.error('\x1b[31mError: Missing prompt for run command.\x1b[0m');
    process.exit(1);
  }
  const prompt = args.join(' ');
  const systemPrompt = buildSystemPrompt();
  const agent = new AgentLoop(systemPrompt);
  try {
    await agent.runTurn(prompt);
  } catch (err: any) {
    console.error(`\x1b[31mExecution Error: ${err.message}\x1b[0m`);
    process.exit(1);
  }
}

async function handlePluginsCli(args: string[]) {
  const subcmd = args[0];
  const pluginDir = join(process.cwd(), '.getit', 'tools');
  if (subcmd === 'reload' || subcmd === 'load') {
    if (existsSync(pluginDir)) {
      await reloadPlugins(process.cwd());
      console.log(`\x1b[32m✓ Loaded plugins: ${getAllPlugins().length}\x1b[0m`);
    } else {
      console.log('\x1b[33mNo plugins directory found at .getit/tools\x1b[0m');
    }
  } else {
    console.log(`Plugins loaded: ${getAllPlugins().length}`);
  }
}

async function handleVaultCli(args: string[]) {
  console.log('\x1b[33mPlease use /vault from the interactive REPL.\x1b[0m');
}

async function handleSyncCli(args: string[]) {
  const profiles = await listProfiles().catch(() => []);
  console.log(`\nSync Profiles: \x1b[1;37m${profiles.length}\x1b[0m`);
  for (const p of profiles) {
    console.log(`  \x1b[36m${p.name}\x1b[0m (machine: ${p.machine}) — ${p.createdAt.slice(0, 10)}`);
  }
}

async function handleWatchCli() {
  const daemon = new WatchDaemon(process.cwd());
  daemon.on('change', (event) => {
    console.log(`\x1b[36m[watch]\x1b[0m ${event.type}: ${event.relativePath}`);
  });
  await daemon.start();
  console.log('\x1b[32m● Watch daemon started. Press Ctrl+C to exit.\x1b[0m');
  
  // Keep alive
  await new Promise(() => {});
}

async function handleRecipeCli(args: string[]) {
  const subcmd = args[0];
  const name = args[1];
  
  if (subcmd === 'run' && name) {
    const recipesDir = join(process.cwd(), '.getit', 'recipes');
    const recipeFile = join(recipesDir, name.endsWith('.yaml') ? name : `${name}.yaml`);
    try {
      const recipe = await loadRecipe(recipeFile);
      await executeRecipe(recipe, {}, {
        onStepStart: (step) => {
          console.log(`\x1b[2mRunning: ${step.tool}(${JSON.stringify(step.args)})\x1b[0m`);
        }
      });
    } catch (err: any) {
      console.error(`\x1b[31mRecipe Error: ${err.message}\x1b[0m`);
      process.exit(1);
    }
  } else {
    console.log('Usage: getit recipe run <name>');
  }
}

// Start the bootstrap routine if run directly
const isMain = () => {
  if (!process.argv[1]) return false;
  try {
    const mainPath = realpathSync(process.argv[1]);
    const modulePath = realpathSync(fileURLToPath(import.meta.url));
    if (mainPath === modulePath) return true;
    
    // Allow wrapper scripts (like dist/index.js or index.js in root) to count as the main entry point
    const wrapperPaths = [
      join(dirname(modulePath), '../index.js'),
      join(dirname(modulePath), '../../index.js'),
    ];
    for (const wrapper of wrapperPaths) {
      if (existsSync(wrapper) && realpathSync(wrapper) === mainPath) {
        return true;
      }
    }
  } catch {
    // Fallback if files or paths can't be resolved
  }
  return false;
};

if (isMain()) {
  bootstrap().catch((err) => {
    console.error('Fatal initialization error:', err);
    process.exit(1);
  });
}
