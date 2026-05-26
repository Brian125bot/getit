import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validatePluginDefinition } from '../src/plugins/validator.js';

describe('Plugins Validator', () => {
  const existingNames = new Set(['existing_tool']);

  it('PLG_009: should validate a correct plugin definition', () => {
    const valid = {
      name: 'valid_tool',
      description: 'A valid tool description here',
      parameters: { type: 'object', properties: {} },
      risk: 'read',
      execute: async () => ({ output: 'ok' })
    };
    const result = validatePluginDefinition(valid as any, existingNames);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it('PLG_010: should reject invalid names', () => {
    const invalidName = {
      name: 'invalid tool!',
      description: 'A valid tool description here',
      parameters: { type: 'object', properties: {} },
      risk: 'read',
      execute: async () => ({ output: 'ok' })
    };
    const result = validatePluginDefinition(invalidName as any, existingNames);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('must match')));
  });

  it('PLG_011: should reject missing or too short descriptions', () => {
    const tooLong = 'A'.repeat(501);
    const longDesc = {
      name: 'valid_tool',
      description: tooLong,
      parameters: { type: 'object', properties: {} },
      risk: 'read',
      execute: async () => ({ output: 'ok' })
    };
    const result = validatePluginDefinition(longDesc as any, existingNames);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('exceeds 500 characters')));
  });

  it('PLG_012: should reject missing parameters object', () => {
    const noParams = {
      name: 'valid_tool',
      description: 'A valid tool with a long description',
      risk: 'read',
      execute: async () => ({ output: 'ok' })
    };
    const result = validatePluginDefinition(noParams as any, existingNames);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('parameters" object property')));
  });

  it('PLG_013: should reject invalid risk level', () => {
    const badRisk = {
      name: 'valid_tool',
      description: 'A valid tool with a long description',
      parameters: { type: 'object', properties: {} },
      risk: 'super_dangerous',
      execute: async () => ({ output: 'ok' })
    };
    const result = validatePluginDefinition(badRisk as any, existingNames);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('must be one of: "read", "write", "system"')));
  });

  it('PLG_014: should reject missing execute function', () => {
    const noExecute = {
      name: 'valid_tool',
      description: 'A valid tool with a long description',
      parameters: { type: 'object', properties: {} },
      risk: 'read'
    };
    const result = validatePluginDefinition(noExecute as any, existingNames);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('must have an "execute" function')));
  });

  it('PLG_015: should reject duplicate names', () => {
    const duplicate = {
      name: 'existing_tool',
      description: 'A valid tool with a long description',
      parameters: { type: 'object', properties: {} },
      risk: 'read',
      execute: async () => ({ output: 'ok' })
    };
    const result = validatePluginDefinition(duplicate as any, existingNames);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('already-loaded plugin')));
  });

  it('PLG_016: should reject builtin tool names', () => {
    const builtin = {
      name: 'execute_bash',
      description: 'A valid tool with a long description',
      parameters: { type: 'object', properties: {} },
      risk: 'read',
      execute: async () => ({ output: 'ok' })
    };
    const result = validatePluginDefinition(builtin as any, existingNames);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('built-in tool')));
  });
});
