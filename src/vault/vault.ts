/**
 * @module vault/vault
 * @description Encrypted vault for multi-machine credential synchronization.
 *
 * The vault stores sensitive configuration data (API keys, tokens, carrier
 * settings) encrypted with AES-256-GCM using a user-provided passphrase.
 * The vault file is safe to sync across machines via git, cloud storage,
 * or manual copy.
 *
 * Encryption uses Node.js native crypto (zero dependencies):
 * - PBKDF2 with 310,000 iterations for key derivation
 * - AES-256-GCM for authenticated encryption
 * - Random 16-byte salt per vault, random 12-byte IV per encryption
 */
import * as crypto from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

export interface VaultData {
  version: number;
  entries: Record<string, VaultEntry>;
  metadata: VaultMetadata;
}

export interface VaultEntry {
  key: string;
  value: string;
  category: 'api_key' | 'carrier_config' | 'preference' | 'custom';
  addedAt: string;
  lastModified: string;
}

export interface VaultMetadata {
  createdAt: string;
  lastUnlockedAt: string;
  machineFingerprint: string;
  entryCount: number;
}

interface EncryptedVault {
  version: number;
  salt: string;       // hex
  iv: string;         // hex
  ciphertext: string; // hex
  tag: string;        // hex
}

const VAULT_DIR = path.join(os.homedir(), '.config', 'getit');
const VAULT_FILE = path.join(VAULT_DIR, 'vault.enc');
const PBKDF2_ITERATIONS = 310_000;
const KEY_LENGTH = 32; // AES-256

let unlockedVault: VaultData | null = null;
let vaultKey: Buffer | null = null;

function getMachineFingerprint(): string {
  const hash = crypto.createHash('sha256');
  hash.update(os.hostname());
  hash.update(os.platform());
  hash.update(os.arch());
  return hash.digest('hex').slice(0, 16);
}

/**
 * Derive encryption key from passphrase using PBKDF2.
 */
function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha512');
}

/**
 * Encrypt vault data.
 */
function encryptVault(data: VaultData, key: Buffer): EncryptedVault {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const plaintext = JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    salt: '', // salt stored separately on creation
    iv: iv.toString('hex'),
    ciphertext: encrypted.toString('hex'),
    tag: tag.toString('hex')
  };
}

/**
 * Decrypt vault data.
 */
function decryptVault(encrypted: EncryptedVault, key: Buffer): VaultData {
  const iv = Buffer.from(encrypted.iv, 'hex');
  const ciphertext = Buffer.from(encrypted.ciphertext, 'hex');
  const tag = Buffer.from(encrypted.tag, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString('utf-8'));
}

/**
 * Check if a vault file exists.
 */
export async function vaultExists(): Promise<boolean> {
  try {
    await fsp.access(VAULT_FILE);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a new vault with the given passphrase.
 */
export async function createVault(passphrase: string): Promise<VaultData> {
  await fsp.mkdir(VAULT_DIR, { recursive: true });

  const salt = crypto.randomBytes(16);
  const key = deriveKey(passphrase, salt);

  const data: VaultData = {
    version: 1,
    entries: {},
    metadata: {
      createdAt: new Date().toISOString(),
      lastUnlockedAt: new Date().toISOString(),
      machineFingerprint: getMachineFingerprint(),
      entryCount: 0
    }
  };

  const encrypted = encryptVault(data, key);
  encrypted.salt = salt.toString('hex');

  await fsp.writeFile(VAULT_FILE, JSON.stringify(encrypted, null, 2), 'utf-8');

  unlockedVault = data;
  vaultKey = key;

  return data;
}

/**
 * Unlock an existing vault with the passphrase.
 */
export async function unlockVault(passphrase: string): Promise<VaultData> {
  const content = await fsp.readFile(VAULT_FILE, 'utf-8');
  const encrypted: EncryptedVault = JSON.parse(content);

  const salt = Buffer.from(encrypted.salt, 'hex');
  const key = deriveKey(passphrase, salt);

  try {
    const data = decryptVault(encrypted, key);
    data.metadata.lastUnlockedAt = new Date().toISOString();
    data.metadata.machineFingerprint = getMachineFingerprint();

    unlockedVault = data;
    vaultKey = key;

    // Re-encrypt with updated metadata
    await saveVault();

    return data;
  } catch (err) {
    throw new Error('Vault decryption failed. Wrong passphrase?');
  }
}

/**
 * Lock the vault (clear in-memory data).
 */
export function lockVault(): void {
  unlockedVault = null;
  vaultKey = null;
}

/**
 * Check if the vault is currently unlocked.
 */
export function isVaultUnlocked(): boolean {
  return unlockedVault !== null;
}

/**
 * Get a vault entry.
 */
export function getVaultEntry(key: string): VaultEntry | undefined {
  if (!unlockedVault) throw new Error('Vault is locked.');
  return unlockedVault.entries[key];
}

/**
 * Set a vault entry.
 */
export async function setVaultEntry(
  key: string,
  value: string,
  category: VaultEntry['category'] = 'custom'
): Promise<void> {
  if (!unlockedVault) throw new Error('Vault is locked.');

  const now = new Date().toISOString();
  unlockedVault.entries[key] = {
    key,
    value,
    category,
    addedAt: unlockedVault.entries[key]?.addedAt || now,
    lastModified: now
  };
  unlockedVault.metadata.entryCount = Object.keys(unlockedVault.entries).length;

  await saveVault();
}

/**
 * Delete a vault entry.
 */
export async function deleteVaultEntry(key: string): Promise<boolean> {
  if (!unlockedVault) throw new Error('Vault is locked.');

  if (key in unlockedVault.entries) {
    delete unlockedVault.entries[key];
    unlockedVault.metadata.entryCount = Object.keys(unlockedVault.entries).length;
    await saveVault();
    return true;
  }
  return false;
}

/**
 * List all vault entries (keys and categories only, not values).
 */
export function listVaultEntries(): Array<{ key: string; category: string; lastModified: string }> {
  if (!unlockedVault) throw new Error('Vault is locked.');

  return Object.values(unlockedVault.entries).map(e => ({
    key: e.key,
    category: e.category,
    lastModified: e.lastModified
  }));
}

/**
 * Export vault data as a portable encrypted blob.
 */
export async function exportVault(): Promise<string> {
  const content = await fsp.readFile(VAULT_FILE, 'utf-8');
  return content;
}

/**
 * Import vault data from a portable encrypted blob.
 */
export async function importVault(blob: string): Promise<void> {
  await fsp.mkdir(VAULT_DIR, { recursive: true });
  // Validate it's valid JSON with expected structure
  const parsed = JSON.parse(blob);
  if (!parsed.salt || !parsed.iv || !parsed.ciphertext || !parsed.tag) {
    throw new Error('Invalid vault format.');
  }
  await fsp.writeFile(VAULT_FILE, blob, 'utf-8');
  lockVault(); // Require re-unlock after import
}

/**
 * Save the current unlocked vault state to disk.
 */
async function saveVault(): Promise<void> {
  if (!unlockedVault || !vaultKey) throw new Error('Vault is locked.');

  const content = await fsp.readFile(VAULT_FILE, 'utf-8');
  const existing: EncryptedVault = JSON.parse(content);

  const encrypted = encryptVault(unlockedVault, vaultKey);
  encrypted.salt = existing.salt; // Preserve original salt

  await fsp.writeFile(VAULT_FILE, JSON.stringify(encrypted, null, 2), 'utf-8');
}
