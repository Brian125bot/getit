import test from 'node:test';
import assert from 'node:assert';
import {
  getPreset,
  normalizeCarrierId,
  inferCarrierId,
  requiresApiKey,
  resolveActivePreset,
  listCarrierPresets,
} from '../src/carriers/registry.js';

test('Carrier registry: lists all presets with valid defaults', () => {
  const presets = listCarrierPresets();
  assert.ok(presets.length >= 10);
  for (const p of presets) {
    assert.ok(p.baseUrl.startsWith('http'));
    assert.ok(p.defaultModel.length > 0);
    assert.ok(p.keyEnvVars.length > 0);
  }
});

test('Carrier registry: normalizes legacy aliases', () => {
  assert.strictEqual(normalizeCarrierId('local'), 'ollama');
  assert.strictEqual(normalizeCarrierId('OPENROUTER'), 'openrouter');
  assert.strictEqual(normalizeCarrierId('unknown-vendor'), 'custom');
});

test('Carrier registry: infers ollama from localhost custom URL', () => {
  assert.strictEqual(
    inferCarrierId('custom', 'http://localhost:11434/v1'),
    'ollama'
  );
});

test('Carrier registry: ollama does not require API key', () => {
  const preset = getPreset('ollama');
  assert.strictEqual(requiresApiKey(preset), false);
});

test('Carrier registry: openai requires API key', () => {
  const preset = getPreset('openai');
  assert.strictEqual(requiresApiKey(preset), true);
});

test('Carrier registry: resolveActivePreset applies base URL override', () => {
  const preset = resolveActivePreset('groq', 'https://api.groq.com/openai/v1');
  assert.strictEqual(preset.id, 'groq');
  assert.strictEqual(preset.baseUrl, 'https://api.groq.com/openai/v1');
});
