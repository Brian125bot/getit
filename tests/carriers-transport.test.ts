import test from 'node:test';
import assert from 'node:assert';
import { getPreset } from '../src/carriers/registry.js';
import { buildRequestHeaders, validateApiAccess } from '../src/carriers/transport.js';

test('Transport: builds OpenRouter referer headers', () => {
  const preset = getPreset('openrouter');
  const headers = buildRequestHeaders(preset, 'sk-test-key');
  assert.strictEqual(headers['Authorization'], 'Bearer sk-test-key');
  assert.ok(headers['HTTP-Referer']);
  assert.ok(headers['X-Title']);
});

test('Transport: ollama keyless headers omit Authorization', () => {
  const preset = getPreset('ollama');
  const headers = buildRequestHeaders(preset, undefined);
  assert.strictEqual(headers['Authorization'], undefined);
  assert.strictEqual(headers['Content-Type'], 'application/json');
});

test('Transport: validateApiAccess allows keyless ollama', () => {
  const preset = getPreset('ollama');
  assert.doesNotThrow(() => validateApiAccess(preset, undefined));
});

test('Transport: validateApiAccess rejects missing openai key', () => {
  const preset = getPreset('openai');
  assert.throws(() => validateApiAccess(preset, undefined), /API key is not set/);
});

test('Transport: azure uses api-key header style', () => {
  const preset = getPreset('azure');
  const headers = buildRequestHeaders(preset, 'azure-secret');
  assert.strictEqual(headers['api-key'], 'azure-secret');
});
