import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyInput, parseArgs, extractPositionalArgs } from '../src/repl/control-plane/classifier.js';

describe('REPL Classifier', () => {
  it('CTL_001: should classify empty input as control_signal', () => {
    const result = classifyInput('   ');
    assert.equal(result.category, 'control_signal');
    assert.equal(result.command, 'noop');
  });

  it('CTL_002: should classify slash command', () => {
    const result = classifyInput('/recipe run tests');
    assert.equal(result.category, 'slash_command');
    assert.equal(result.command, '/recipe');
    assert.equal(result.args, 'run tests');
  });

  it('CTL_003: should classify recipe invocation', () => {
    const result = classifyInput('@deploy-prod --dry-run');
    assert.equal(result.category, 'recipe_invoke');
    assert.equal(result.recipeName, 'deploy-prod');
    assert.equal(result.args, '--dry-run');
  });

  it('CTL_004: should classify macro invocation', () => {
    const result = classifyInput('!fix-lint src/index.ts');
    assert.equal(result.category, 'macro_invoke');
    assert.equal(result.macroName, 'fix-lint');
    assert.equal(result.args, 'src/index.ts');
  });

  it('CTL_005: should classify SIGINT', () => {
    const result = classifyInput('\x03');
    assert.equal(result.category, 'control_signal');
    assert.equal(result.command, 'interrupt');
  });

  it('CTL_006: should classify natural language prompt', () => {
    const result = classifyInput('Could you write some tests?');
    assert.equal(result.category, 'natural_language');
    assert.equal(result.raw, 'Could you write some tests?');
  });

  it('CTL_007: should parse key=value arguments', () => {
    const parsed = parseArgs('dir=src force=true env="test env"');
    assert.equal(parsed['dir'], 'src');
    assert.equal(parsed['force'], 'true');
    assert.equal(parsed['env'], 'test env');
  });

  it('CTL_008: should extract positional arguments', () => {
    const pos = extractPositionalArgs('deploy --force dir=src file="main.js" test');
    assert.deepEqual(pos, ['deploy', '--force', 'test']);
  });
});
