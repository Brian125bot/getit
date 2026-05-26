import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

// Override global getit config dir for preferences test
const mockConfigDir = path.join(os.tmpdir(), 'getit-test-prefs-mock-' + Date.now());
process.env.GETIT_CONFIG_DIR = mockConfigDir;

import { 
  loadPreferences, 
  savePreferences, 
  buildPreferencesContext, 
  updatePreference 
} from '../src/memory/preferences.js';

describe('Memory Preferences', () => {
  before(async () => {
    await fsp.mkdir(mockConfigDir, { recursive: true });
  });

  after(async () => {
    await fsp.rm(mockConfigDir, { recursive: true, force: true });
    delete process.env.GETIT_CONFIG_DIR;
  });

  beforeEach(async () => {
    // Reset preferences file
    const file = path.join(mockConfigDir, 'preferences.json');
    if (await fsp.stat(file).catch(() => null)) {
      await fsp.unlink(file);
    }
  });

  it('MEM_017: should load default preferences when file does not exist', async () => {
    const prefs = await loadPreferences();
    assert.ok(prefs);
    assert.equal(typeof prefs.verbosity, 'string');
  });

  it('MEM_018: should save preferences to disk', async () => {
    const prefs = await loadPreferences();
    prefs.custom['theme'] = 'light';
    await savePreferences(prefs);
    
    const loaded = await loadPreferences();
    assert.equal(loaded.custom['theme'], 'light');
  });

  it('MEM_019: should update a specific preference key', async () => {
    await updatePreference('editor', 'vim');
    const prefs = await loadPreferences();
    assert.equal(prefs.custom['editor'], 'vim');
  });

  it('MEM_020: should build preferences context string', async () => {
    await updatePreference('theme', 'dark');
    const ctx = buildPreferencesContext();
    assert.ok(ctx.includes('theme'));
  });

  it('MEM_021: should handle partial preferences loading gracefully', async () => {
    const file = path.join(mockConfigDir, 'preferences.json');
    await fsp.writeFile(file, JSON.stringify({ custom: { theme: 'test-theme' } }));
    
    const prefs = await loadPreferences();
    assert.equal(prefs.custom['theme'], 'test-theme');
    assert.ok(prefs.verbosity !== undefined); // defaults merged
  });

  it('MEM_022: should handle invalid JSON in preferences file', async () => {
    const file = path.join(mockConfigDir, 'preferences.json');
    await fsp.writeFile(file, '{ invalid: json ]');
    
    const prefs = await loadPreferences();
    assert.ok(prefs); // Should fallback to defaults
  });

  it('MEM_023: should update nested preferences if any exist', async () => {
    await updatePreference('behavior.autoFormat', 'true');
    const prefs = await loadPreferences();
    assert.equal(prefs.custom['behavior.autoFormat'], 'true');
  });

  it('MEM_024: should allow passing direct preferences object to build context', async () => {
    const prefs = await loadPreferences();
    prefs.custom['custom_pref'] = 'hello';
    const ctx = buildPreferencesContext(prefs);
    assert.ok(ctx.includes('custom_pref'));
    assert.ok(ctx.includes('hello'));
  });
});
