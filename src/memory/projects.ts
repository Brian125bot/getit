/**
 * @module memory/projects
 * @description Project-level memory for getit v2.0.
 *
 * Maintains a persistent record of project-specific knowledge: tech stack,
 * common commands, file patterns, and accumulated agent learnings. This
 * information is injected into the system prompt to give the agent deep
 * project context without re-discovery every session.
 */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

export interface ProjectMemory {
  fingerprint: string;
  projectName: string;
  rootPath: string;
  techStack: TechStackInfo;
  commonCommands: CommandEntry[];
  filePatterns: FilePatternEntry[];
  learnings: LearningEntry[];
  lastUpdated: string;
}

export interface TechStackInfo {
  language: string;
  framework?: string;
  packageManager: string;
  buildTool?: string;
  testRunner?: string;
  detected: string[];
}

export interface CommandEntry {
  command: string;
  description: string;
  frequency: number;
  lastUsed: string;
}

export interface FilePatternEntry {
  pattern: string;
  description: string;
  examples: string[];
}

export interface LearningEntry {
  id: string;
  content: string;
  category: 'error_fix' | 'preference' | 'workflow' | 'optimization' | 'general';
  timestamp: string;
}

const DATA_DIR = path.join(os.homedir(), '.local', 'state', 'getit', 'projects');

function getProjectPath(fingerprint: string): string {
  return path.join(DATA_DIR, `${fingerprint}.json`);
}

async function ensureDir(): Promise<void> {
  await fsp.mkdir(DATA_DIR, { recursive: true });
}

/**
 * Load project memory for a workspace fingerprint.
 */
export async function loadProjectMemory(fingerprint: string): Promise<ProjectMemory | null> {
  await ensureDir();
  try {
    const content = await fsp.readFile(getProjectPath(fingerprint), 'utf-8');
    return JSON.parse(content) as ProjectMemory;
  } catch {
    return null;
  }
}

/**
 * Save project memory.
 */
export async function saveProjectMemory(memory: ProjectMemory): Promise<void> {
  await ensureDir();
  memory.lastUpdated = new Date().toISOString();
  await fsp.writeFile(getProjectPath(memory.fingerprint), JSON.stringify(memory, null, 2), 'utf-8');
}

/**
 * Auto-detect tech stack from workspace root.
 */
export async function detectTechStack(rootPath: string): Promise<TechStackInfo> {
  const detected: string[] = [];
  const info: TechStackInfo = {
    language: 'unknown',
    packageManager: 'unknown',
    detected
  };

  const exists = async (name: string) => {
    try { await fsp.access(path.join(rootPath, name)); return true; } catch { return false; }
  };

  // Language detection
  if (await exists('package.json')) {
    info.language = 'typescript/javascript';
    detected.push('package.json');
    try {
      const pkg = JSON.parse(await fsp.readFile(path.join(rootPath, 'package.json'), 'utf-8'));
      if (pkg.dependencies?.react || pkg.devDependencies?.react) {
        info.framework = 'react';
        detected.push('react');
      }
      if (pkg.dependencies?.next || pkg.devDependencies?.next) {
        info.framework = 'next.js';
        detected.push('next.js');
      }
      if (pkg.dependencies?.vue || pkg.devDependencies?.vue) {
        info.framework = 'vue';
        detected.push('vue');
      }
      if (pkg.devDependencies?.vitest) {
        info.testRunner = 'vitest';
        detected.push('vitest');
      } else if (pkg.devDependencies?.jest) {
        info.testRunner = 'jest';
        detected.push('jest');
      }
    } catch {}
  }
  if (await exists('Cargo.toml')) { info.language = 'rust'; detected.push('Cargo.toml'); }
  if (await exists('go.mod')) { info.language = 'go'; detected.push('go.mod'); }
  if (await exists('pyproject.toml')) { info.language = 'python'; detected.push('pyproject.toml'); }

  // Package manager detection
  if (await exists('pnpm-lock.yaml')) { info.packageManager = 'pnpm'; detected.push('pnpm'); }
  else if (await exists('yarn.lock')) { info.packageManager = 'yarn'; detected.push('yarn'); }
  else if (await exists('bun.lockb')) { info.packageManager = 'bun'; detected.push('bun'); }
  else if (await exists('package-lock.json')) { info.packageManager = 'npm'; detected.push('npm'); }

  // Build tool detection
  if (await exists('vite.config.ts') || await exists('vite.config.js')) {
    info.buildTool = 'vite'; detected.push('vite');
  } else if (await exists('webpack.config.js')) {
    info.buildTool = 'webpack'; detected.push('webpack');
  } else if (await exists('tsconfig.json')) {
    info.buildTool = 'tsc'; detected.push('tsc');
  }

  return info;
}

/**
 * Record a frequently used command in project memory.
 */
export async function recordCommand(
  fingerprint: string,
  command: string,
  description: string
): Promise<void> {
  const memory = await loadProjectMemory(fingerprint);
  if (!memory) return;

  const existing = memory.commonCommands.find(c => c.command === command);
  if (existing) {
    existing.frequency++;
    existing.lastUsed = new Date().toISOString();
  } else {
    memory.commonCommands.push({
      command,
      description,
      frequency: 1,
      lastUsed: new Date().toISOString()
    });
  }

  // Keep only top 20 most-used commands
  memory.commonCommands.sort((a, b) => b.frequency - a.frequency);
  if (memory.commonCommands.length > 20) {
    memory.commonCommands = memory.commonCommands.slice(0, 20);
  }

  await saveProjectMemory(memory);
}

/**
 * Add a learning to project memory.
 */
export async function addLearning(
  fingerprint: string,
  content: string,
  category: LearningEntry['category'] = 'general'
): Promise<void> {
  const memory = await loadProjectMemory(fingerprint);
  if (!memory) return;

  const crypto = await import('node:crypto');
  memory.learnings.push({
    id: `learn_${crypto.randomUUID()}`,
    content,
    category,
    timestamp: new Date().toISOString()
  });

  // Keep max 50 learnings
  if (memory.learnings.length > 50) {
    memory.learnings = memory.learnings.slice(-50);
  }

  await saveProjectMemory(memory);
}

/**
 * Build project context string for system prompt injection.
 */
export function buildProjectContext(memory: ProjectMemory): string {
  const lines: string[] = ['## Project Context'];

  lines.push(`- Project: ${memory.projectName}`);
  lines.push(`- Language: ${memory.techStack.language}`);
  if (memory.techStack.framework) lines.push(`- Framework: ${memory.techStack.framework}`);
  lines.push(`- Package Manager: ${memory.techStack.packageManager}`);
  if (memory.techStack.buildTool) lines.push(`- Build Tool: ${memory.techStack.buildTool}`);
  if (memory.techStack.testRunner) lines.push(`- Test Runner: ${memory.techStack.testRunner}`);

  if (memory.commonCommands.length > 0) {
    lines.push('\n### Frequently Used Commands');
    for (const cmd of memory.commonCommands.slice(0, 10)) {
      lines.push(`- \`${cmd.command}\` — ${cmd.description} (used ${cmd.frequency}x)`);
    }
  }

  if (memory.learnings.length > 0) {
    lines.push('\n### Accumulated Learnings');
    for (const learn of memory.learnings.slice(-10)) {
      lines.push(`- [${learn.category}] ${learn.content}`);
    }
  }

  return lines.join('\n');
}

/**
 * Initialize project memory for a new workspace.
 */
export async function initProjectMemory(
  fingerprint: string,
  projectName: string,
  rootPath: string
): Promise<ProjectMemory> {
  const techStack = await detectTechStack(rootPath);

  const memory: ProjectMemory = {
    fingerprint,
    projectName,
    rootPath,
    techStack,
    commonCommands: [],
    filePatterns: [],
    learnings: [],
    lastUpdated: new Date().toISOString()
  };

  await saveProjectMemory(memory);
  return memory;
}
