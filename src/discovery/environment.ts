import * as os from 'node:os';
import { execSync, spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';

export interface EnvironmentContext {
  arch: string;
  binaries: Record<string, boolean>;
  localBinInPath: boolean;
  osName: string;
  homeDir: string;
  targetPlatform: string;
  distributionRelease: string;
  primaryPackageManager: string;
  userBinaryPath: string;
  verifiedBinaries: string[];
}

export function discoverEnvironment(): EnvironmentContext {
  const homeDir = os.homedir();
  
  // 1. CPU Architecture
  let arch = os.arch();
  if (arch === 'x64') {
    arch = 'x86_64';
  } else if (arch === 'arm64') {
    arch = 'arm64'; // or 'aarch64' as required by spec: "mapping cleanly to x86_64/amd64 or aarch64/arm64"
  }

  const platform = os.platform();
  const distro = detectDistribution(platform);
  const primaryPackageManager = detectPackageManager(platform, distro.id);

  // 2. Host Dependencies
  const dependencies = ['curl', 'tar', 'unzip', primaryPackageManager].filter((dep, index, arr) => dep && arr.indexOf(dep) === index);
  const binaries: Record<string, boolean> = {};

  for (const dep of dependencies) {
    binaries[dep] = commandExists(dep);
  }

  // 3. Path Configuration
  const pathEnv = process.env.PATH || '';
  const localBinPath = path.join(homeDir, '.local/bin');
  
  // Check if standard path array contains the local bin directory (both relative-looking tilde or absolute resolved)
  const paths = pathEnv.split(path.delimiter);
  const localBinInPath = paths.some(p => {
    const resolved = p.startsWith('~') ? path.join(homeDir, p.slice(1)) : path.resolve(p);
    return resolved === localBinPath;
  });

  return {
    arch,
    binaries,
    localBinInPath,
    osName: os.type(),
    homeDir,
    targetPlatform: platform,
    distributionRelease: distro.release,
    primaryPackageManager,
    userBinaryPath: localBinPath,
    verifiedBinaries: Object.entries(binaries).filter(([, available]) => available).map(([name]) => name)
  };
}

function commandExists(command: string): boolean {
  if (!command || command === 'unknown') return false;
  try {
    execSync(`command -v ${command}`, { stdio: 'ignore', shell: '/bin/bash' });
    return true;
  } catch {
    return false;
  }
}

function detectDistribution(platform: NodeJS.Platform): { id: string; release: string } {
  if (platform === 'darwin') {
    const swVers = spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf-8', timeout: 1000 });
    const version = swVers.status === 0 ? swVers.stdout.trim() : os.release();
    return { id: 'macos', release: `macOS ${version}` };
  }

  if (platform === 'linux' && fs.existsSync('/etc/os-release')) {
    try {
      const data = parseOsRelease(fs.readFileSync('/etc/os-release', 'utf-8'));
      return {
        id: data.ID || '',
        release: data.PRETTY_NAME || data.VERSION || os.release()
      };
    } catch {
      return { id: 'linux', release: os.release() };
    }
  }

  return { id: platform, release: os.release() };
}

function detectPackageManager(platform: NodeJS.Platform, distroId: string): string {
  if (platform === 'darwin') return 'brew';
  if (platform !== 'linux') return 'unknown';
  if (['ubuntu', 'debian', 'linuxmint', 'pop'].includes(distroId)) return 'apt-get';
  if (['fedora', 'rhel', 'centos', 'rocky', 'almalinux'].includes(distroId)) return 'dnf';
  if (['arch', 'manjaro'].includes(distroId)) return 'pacman';
  for (const candidate of ['apt-get', 'dnf', 'pacman']) {
    if (commandExists(candidate)) return candidate;
  }
  return 'unknown';
}

function parseOsRelease(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line);
    if (!match) continue;
    result[match[1]] = match[2].replace(/^"|"$/g, '');
  }
  return result;
}
