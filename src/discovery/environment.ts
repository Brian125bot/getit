import * as os from 'node:os';
import { execSync } from 'node:child_process';
import * as path from 'node:path';

export interface EnvironmentContext {
  arch: string;
  binaries: Record<string, boolean>;
  localBinInPath: boolean;
  osName: string;
  homeDir: string;
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

  // 2. Host Dependencies
  const dependencies = ['curl', 'tar', 'unzip', 'apt-get'];
  const binaries: Record<string, boolean> = {};

  for (const dep of dependencies) {
    try {
      execSync(`which ${dep}`, { stdio: 'ignore' });
      binaries[dep] = true;
    } catch {
      binaries[dep] = false;
    }
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
    homeDir
  };
}
