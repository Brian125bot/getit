/**
 * @module watcher/daemon
 * @description File system watch daemon for getit v2.0.
 *
 * Uses Node.js native `fs.watch()` to monitor workspace files for changes.
 * Supports recursive watching, glob-based include/exclude patterns,
 * debounced event emission, and configurable action hooks.
 */
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { EventEmitter } from 'node:events';

export type WatchEventType = 'create' | 'modify' | 'delete';

export interface WatchEvent {
  type: WatchEventType;
  filePath: string;
  relativePath: string;
  timestamp: number;
}

export interface WatchConfig {
  /** Directories to watch. */
  paths: string[];
  /** Glob patterns to include. Empty = include all. */
  include: string[];
  /** Glob patterns to exclude. */
  exclude: string[];
  /** Debounce interval in milliseconds. */
  debounceMs: number;
  /** Whether to watch recursively. */
  recursive: boolean;
}

function defaultConfig(): WatchConfig {
  return {
    paths: ['.'],
    include: [],
    exclude: [
      'node_modules/**', '.git/**', '.getit/**', 'dist/**',
      '*.log', '.DS_Store', 'coverage/**'
    ],
    debounceMs: 300,
    recursive: true
  };
}

/**
 * Simple glob pattern matcher. Supports *, **, and ? wildcards.
 */
function matchGlob(pattern: string, filePath: string): boolean {
  const regexStr = pattern
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');
  return new RegExp(`^${regexStr}$`).test(filePath);
}

function shouldInclude(relativePath: string, config: WatchConfig): boolean {
  // Check excludes first
  for (const pattern of config.exclude) {
    if (matchGlob(pattern, relativePath)) return false;
  }

  // If no includes specified, include everything not excluded
  if (config.include.length === 0) return true;

  // Check includes
  for (const pattern of config.include) {
    if (matchGlob(pattern, relativePath)) return true;
  }

  return false;
}

export class WatchDaemon extends EventEmitter {
  private watchers: fs.FSWatcher[] = [];
  private config: WatchConfig;
  private rootPath: string;
  private running = false;
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private knownFiles = new Set<string>();

  constructor(rootPath: string, config: Partial<WatchConfig> = {}) {
    super();
    this.rootPath = path.resolve(rootPath);
    this.config = { ...defaultConfig(), ...config };
  }

  /**
   * Start the file watcher.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Build initial file list
    await this.scanExistingFiles();

    // Start watchers for each configured path
    for (const watchPath of this.config.paths) {
      const fullPath = path.resolve(this.rootPath, watchPath);
      try {
        const watcher = fs.watch(
          fullPath,
          { recursive: this.config.recursive },
          (eventType, filename) => {
            if (filename) {
              this.handleEvent(eventType, filename, fullPath);
            }
          }
        );

        watcher.on('error', (err) => {
          this.emit('error', err);
        });

        this.watchers.push(watcher);
      } catch (err) {
        this.emit('error', err);
      }
    }

    this.emit('started');
  }

  /**
   * Stop the file watcher.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    this.emit('stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  private async scanExistingFiles(): Promise<void> {
    for (const watchPath of this.config.paths) {
      const fullPath = path.resolve(this.rootPath, watchPath);
      await this.scanDirectory(fullPath);
    }
  }

  private async scanDirectory(dirPath: string): Promise<void> {
    try {
      const entries = await fsp.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(this.rootPath, fullPath);

        if (entry.isDirectory()) {
          if (shouldInclude(relativePath + '/', this.config)) {
            await this.scanDirectory(fullPath);
          }
        } else if (entry.isFile()) {
          if (shouldInclude(relativePath, this.config)) {
            this.knownFiles.add(relativePath);
          }
        }
      }
    } catch { /* skip inaccessible directories */ }
  }

  private handleEvent(eventType: string, filename: string, watchBase: string): void {
    const fullPath = path.join(watchBase, filename);
    const relativePath = path.relative(this.rootPath, fullPath);

    if (!shouldInclude(relativePath, this.config)) return;

    // Debounce
    if (this.debounceTimers.has(relativePath)) {
      clearTimeout(this.debounceTimers.get(relativePath)!);
    }

    this.debounceTimers.set(relativePath, setTimeout(async () => {
      this.debounceTimers.delete(relativePath);

      let type: WatchEventType;

      try {
        await fsp.access(fullPath);
        // File exists
        if (this.knownFiles.has(relativePath)) {
          type = 'modify';
        } else {
          type = 'create';
          this.knownFiles.add(relativePath);
        }
      } catch {
        // File doesn't exist — it was deleted
        type = 'delete';
        this.knownFiles.delete(relativePath);
      }

      const event: WatchEvent = {
        type,
        filePath: fullPath,
        relativePath,
        timestamp: Date.now()
      };

      this.emit('change', event);
    }, this.config.debounceMs));
  }
}
