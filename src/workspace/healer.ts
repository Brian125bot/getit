import * as fs from 'node:fs';
import { discoverEnvironment } from '../discovery/environment.js';

export interface HealingRule {
  name: string;
  pattern: RegExp;
  getFixCommand: (match: string[], packageManager: string, platform: string) => string;
  description: string;
}

const HEALING_RULES: HealingRule[] = [
  {
    name: 'Command not found',
    pattern: /(?:bash: |sh: |command not found: )([^:\s]+)|([^:\s]+): command not found/i,
    getFixCommand: (match, pkgMgr, platform) => {
      const command = match[1] || match[2];
      if (pkgMgr === 'apt-get') return `sudo apt-get update && sudo apt-get install -y ${command}`;
      if (pkgMgr === 'brew') return `brew install ${command}`;
      if (pkgMgr === 'dnf') return `sudo dnf install -y ${command}`;
      if (pkgMgr === 'pacman') return `sudo pacman -S --noconfirm ${command}`;
      return `install ${command}`;
    },
    description: 'A required command/binary is missing from the system path.'
  },
  {
    name: 'Missing shared library',
    pattern: /error while loading shared libraries:\s+(\S+\.so\S*):\s+cannot open shared object file/i,
    getFixCommand: (match, pkgMgr, platform) => {
      const lib = match[1];
      let pkgName = lib;
      if (lib.includes('libssl')) pkgName = 'libssl-dev';
      else if (lib.includes('libz')) pkgName = 'zlib1g-dev';
      
      if (pkgMgr === 'apt-get') return `sudo apt-get update && sudo apt-get install -y ${pkgName}`;
      if (pkgMgr === 'brew') return `brew install ${pkgName}`;
      if (pkgMgr === 'dnf') return `sudo dnf install -y ${pkgName}`;
      if (pkgMgr === 'pacman') return `sudo pacman -S --noconfirm ${pkgName}`;
      return `install ${pkgName}`;
    },
    description: 'A required dynamic shared library (.so file) is missing.'
  },
  {
    name: 'Missing Python package',
    pattern: /ModuleNotFoundError: No module named '(\S+)'|ImportError: No module named (\S+)/i,
    getFixCommand: (match, pkgMgr, platform) => {
      const pkg = match[1] || match[2];
      return `pip install ${pkg}`;
    },
    description: 'A required Python dependency/module is missing.'
  },
  {
    name: 'Missing Node module',
    pattern: /Error: Cannot find module '(\S+)'/i,
    getFixCommand: (match, pkgMgr, platform) => {
      const moduleName = match[1];
      if (fs.existsSync('package.json')) {
        return `npm install ${moduleName}`;
      }
      return `npm install -g ${moduleName}`;
    },
    description: 'A required Node.js package/module is missing.'
  }
];

/**
 * Scans stderr for common dependency/binary errors and returns a deterministic
 * remediation command mapped to the host's package manager.
 */
export function attemptDependencyHealing(stderr: string): { matched: boolean; command?: string; description?: string } {
  const env = discoverEnvironment();
  const pkgMgr = env.primaryPackageManager;
  const platform = env.targetPlatform;

  for (const rule of HEALING_RULES) {
    const match = rule.pattern.exec(stderr);
    if (match) {
      const cmd = rule.getFixCommand(match, pkgMgr, platform);
      return {
        matched: true,
        command: cmd,
        description: rule.description
      };
    }
  }

  return { matched: false };
}
