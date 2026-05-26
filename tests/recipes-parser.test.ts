import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseRecipeYaml, serializeRecipeYaml, parseSimpleYaml } from '../src/recipes/yaml-parser.js';

describe('Recipes Parser', () => {
  const validYaml = `
name: test_recipe
description: "A test recipe"
version: 1.0.0
parameters:
  - name: dir
    required: true
steps:
  - id: step1
    tool: run_command
    args:
      command: "ls {{dir}}"
`;

  it('RCP_001: should parse valid YAML recipe', () => {
    const recipe = parseRecipeYaml(validYaml);
    assert.equal(recipe.name, 'test_recipe');
    assert.equal(recipe.steps.length, 1);
    assert.equal(recipe.steps[0].tool, 'run_command');
  });

  it('RCP_002: should fall back to default version if missing', () => {
    const recipe = parseRecipeYaml(`
name: test_recipe
steps:
  - id: step1
    tool: test
    args: {}
`);
    assert.equal(recipe.version, '1.0.0');
  });

  it('RCP_003: should serialize recipe to YAML', () => {
    const recipe = parseRecipeYaml(validYaml);
    const yamlStr = serializeRecipeYaml(recipe);
    assert.ok(yamlStr.includes('name: test_recipe'));
    assert.ok(yamlStr.includes('tool: run_command'));
  });

  it('RCP_004: should parse arrays correctly', () => {
    const yaml = `
list:
  - one
  - two
`;
    const parsed = parseSimpleYaml(yaml);
    assert.deepEqual((parsed as any).list, ['one', 'two']);
  });

  it('RCP_005: should parse inline mapping in arrays', () => {
    const yaml = `
list:
  - name: one, val: 1
`;
    const parsed = parseSimpleYaml(yaml);
    assert.equal((parsed as any).list[0].name, 'one');
    assert.equal((parsed as any).list[0].val, 1);
  });
});
