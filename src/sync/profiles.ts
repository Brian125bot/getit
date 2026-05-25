/**
 * @module sync/profiles
 * @description Multi-machine profile synchronization for getit v2.0.
 *
 * Profiles capture the full state of a getit installation: carrier config,
 * active model, preferences, plugin list, and trusted recipes. Profiles
 * can be exported/imported to quickly replicate a setup across machines.
 */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';

export interface SyncProfile {
  id: string;
  name: string;
  version: string;
  createdAt: string;
  machineFingerprint: string;
  carrier: CarrierProfile;
  preferences: Record<string, unknown>;
  plugins: string[];
  trustedRecipes: string[];
}

export interface CarrierProfile {
  carrierId: string;
  model: string;
  baseUrl?: string;
  timeout: number;
}

const PROFILES_DIR = path.join(os.homedir(), '.config', 'getit', 'profiles');

async function ensureDir(): Promise<void> {
  await fsp.mkdir(PROFILES_DIR, { recursive: true });
}

function getMachineFingerprint(): string {
  const hash = crypto.createHash('sha256');
  hash.update(os.hostname());
  hash.update(os.platform());
  hash.update(os.arch());
  return hash.digest('hex').slice(0, 16);
}

/**
 * Create a new sync profile.
 */
export async function createProfile(
  name: string,
  carrier: CarrierProfile,
  preferences: Record<string, unknown> = {},
  plugins: string[] = [],
  trustedRecipes: string[] = []
): Promise<SyncProfile> {
  await ensureDir();

  const profile: SyncProfile = {
    id: `prof_${crypto.randomUUID()}`,
    name,
    version: '2.0.0',
    createdAt: new Date().toISOString(),
    machineFingerprint: getMachineFingerprint(),
    carrier,
    preferences,
    plugins,
    trustedRecipes
  };

  const filePath = path.join(PROFILES_DIR, `${name}.json`);
  await fsp.writeFile(filePath, JSON.stringify(profile, null, 2), 'utf-8');

  return profile;
}

/**
 * Load a profile by name.
 */
export async function loadProfile(name: string): Promise<SyncProfile | null> {
  try {
    const content = await fsp.readFile(path.join(PROFILES_DIR, `${name}.json`), 'utf-8');
    return JSON.parse(content) as SyncProfile;
  } catch {
    return null;
  }
}

/**
 * List all available profiles.
 */
export async function listProfiles(): Promise<Array<{ name: string; createdAt: string; machine: string }>> {
  await ensureDir();
  const entries = await fsp.readdir(PROFILES_DIR);
  const profiles: Array<{ name: string; createdAt: string; machine: string }> = [];

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const content = await fsp.readFile(path.join(PROFILES_DIR, entry), 'utf-8');
      const prof = JSON.parse(content) as SyncProfile;
      profiles.push({
        name: prof.name,
        createdAt: prof.createdAt,
        machine: prof.machineFingerprint
      });
    } catch { /* skip invalid */ }
  }

  return profiles;
}

/**
 * Delete a profile by name.
 */
export async function deleteProfile(name: string): Promise<boolean> {
  try {
    await fsp.unlink(path.join(PROFILES_DIR, `${name}.json`));
    return true;
  } catch {
    return false;
  }
}

/**
 * Export a profile as a portable JSON string.
 */
export async function exportProfile(name: string): Promise<string | null> {
  const profile = await loadProfile(name);
  if (!profile) return null;
  return JSON.stringify(profile, null, 2);
}

/**
 * Import a profile from a JSON string.
 */
export async function importProfile(json: string): Promise<SyncProfile> {
  const profile = JSON.parse(json) as SyncProfile;
  if (!profile.name || !profile.carrier) {
    throw new Error('Invalid profile format.');
  }

  await ensureDir();
  const filePath = path.join(PROFILES_DIR, `${profile.name}.json`);
  await fsp.writeFile(filePath, JSON.stringify(profile, null, 2), 'utf-8');

  return profile;
}
