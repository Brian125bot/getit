import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

let vaultExists: any;
let createVault: any;
let unlockVault: any;
let lockVault: any;
let isVaultUnlocked: any;
let setVaultEntry: any;
let getVaultEntry: any;
let deleteVaultEntry: any;
let listVaultEntries: any;

const mockVaultDir = path.join(os.tmpdir(), 'getit-test-vault-' + Date.now());

describe('Sync Vault', () => {
  before(async () => {
    process.env.GETIT_CONFIG_DIR = mockVaultDir;
    await fsp.mkdir(mockVaultDir, { recursive: true });
    
    const vaultModule = await import('../src/vault/vault.js');
    vaultExists = vaultModule.vaultExists;
    createVault = vaultModule.createVault;
    unlockVault = vaultModule.unlockVault;
    lockVault = vaultModule.lockVault;
    isVaultUnlocked = vaultModule.isVaultUnlocked;
    setVaultEntry = vaultModule.setVaultEntry;
    getVaultEntry = vaultModule.getVaultEntry;
    deleteVaultEntry = vaultModule.deleteVaultEntry;
    listVaultEntries = vaultModule.listVaultEntries;
  });

  after(async () => {
    delete process.env.GETIT_CONFIG_DIR;
    await fsp.rm(mockVaultDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    lockVault();
  });

  it('SYN_001: should report vault does not exist initially', async () => {
    assert.equal(await vaultExists(), false);
  });

  it('SYN_002: should create a new vault', async () => {
    await createVault('password123');
    assert.equal(await vaultExists(), true);
  });

  it('SYN_003: should be locked after creation (must unlock explicitly)', () => {
    assert.equal(isVaultUnlocked(), false);
  });

  it('SYN_004: should unlock with correct passphrase', async () => {
    await unlockVault('password123');
    assert.equal(isVaultUnlocked(), true);
  });

  it('SYN_005: should fail to unlock with wrong passphrase', async () => {
    try {
      await unlockVault('wrongpass');
      assert.fail('Should have thrown on wrong password');
    } catch (e: any) {
      assert.ok(e.message.includes('password') || e.message.includes('decrypt'));
    }
    assert.equal(isVaultUnlocked(), false);
  });

  it('SYN_006: should set and get vault entries', async () => {
    await unlockVault('password123');
    await setVaultEntry('api_key', '12345', 'custom');
    const val = await getVaultEntry('api_key');
    assert.equal(val.value, '12345');
  });

  it('SYN_007: should list vault entries', async () => {
    await unlockVault('password123');
    await setVaultEntry('token1', 'abc', 'custom');
    await setVaultEntry('token2', 'def', 'custom');
    const entries = await listVaultEntries();
    assert.ok(entries.some((e: any) => e.key === 'token1'));
    assert.ok(entries.some((e: any) => e.key === 'token2'));
  });

  it('SYN_008: should delete vault entries', async () => {
    await unlockVault('password123');
    await deleteVaultEntry('token1');
    const entries = await listVaultEntries();
    assert.equal(entries.some((e: any) => e.key === 'token1'), false);
    const val = await getVaultEntry('token1');
    assert.equal(val, undefined);
  });

  it('SYN_009: should fail to get entry if locked', async () => {
    try {
      await getVaultEntry('api_key');
      assert.fail('Should have thrown');
    } catch (e: any) {
      assert.ok(e.message.includes('locked'));
    }
  });

  it('SYN_010: should persist data across lock/unlock cycles', async () => {
    await unlockVault('password123');
    await setVaultEntry('persistent_key', 'persist_val', 'custom');
    lockVault();
    
    assert.equal(isVaultUnlocked(), false);
    
    await unlockVault('password123');
    const val = await getVaultEntry('persistent_key');
    assert.equal(val.value, 'persist_val');
  });
});
