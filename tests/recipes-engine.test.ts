import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { 
  discoverRecipes, 
  loadRecipe, 
  validateParameters, 
  executeRecipe 
} from '../src/recipes/engine.js';
import * as toolsRegistry from '../src/tools/registry.js';

describe('Recipes Engine', () => {
  let workspaceRoot: string;
  let recipesDir: string;

  before(async () => {
    workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'getit-test-recipes-'));
    recipesDir = path.join(workspaceRoot, '.getit', 'recipes');
    await fsp.mkdir(recipesDir, { recursive: true });
    
    const recipeYaml = `
name: test_recipe_engine
description: Test
version: 1.0.0
parameters:
  - name: test_param
    required: true
steps:
  - id: s1
    tool: test_tool
    args:
      val: "{{test_param}}"
`;
    await fsp.writeFile(path.join(recipesDir, 'test_recipe_engine.yaml'), recipeYaml);
  });

  after(async () => {
    await fsp.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('RCP_009: should discover recipes', async () => {
    const recipes = await discoverRecipes(workspaceRoot);
    assert.ok(recipes.some(r => r.name === 'test_recipe_engine'));
  });

  it('RCP_010: should load a recipe from file', async () => {
    const file = path.join(recipesDir, 'test_recipe_engine.yaml');
    const recipe = await loadRecipe(file);
    assert.equal(recipe.name, 'test_recipe_engine');
  });

  it('RCP_011: should validate parameters', async () => {
    const recipe = await loadRecipe(path.join(recipesDir, 'test_recipe_engine.yaml'));
    const { valid, errors } = validateParameters(recipe, { test_param: 'hello' });
    assert.equal(valid, true);
    assert.equal(errors.length, 0);
  });

  it('RCP_012: should fail validation if required param is missing', async () => {
    const recipe = await loadRecipe(path.join(recipesDir, 'test_recipe_engine.yaml'));
    const { valid, errors } = validateParameters(recipe, {});
    assert.equal(valid, false);
    assert.ok(errors.length > 0);
  });
});
