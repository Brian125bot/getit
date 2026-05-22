import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { TerminalSpinner } from '../src/ui/spinner.js';

describe('TerminalSpinner', () => {
  let writeMock: any;
  let originalWrite: any;
  let output = '';

  before(() => {
    originalWrite = process.stdout.write;
    process.stdout.write = (chunk: any) => {
      output += chunk.toString();
      return true;
    };
  });

  after(() => {
    process.stdout.write = originalWrite;
  });

  test('should initialize and start the spinner', async () => {
    output = '';
    const spinner = new TerminalSpinner('Testing');
    spinner.start();
    
    assert.ok(output.includes('\x1B[?25l'), 'Should hide cursor');
    assert.ok(output.includes('Testing'), 'Should contain initial text');
    
    spinner.succeed('Done testing');
    
    assert.ok(output.includes('\x1b[32m✔\x1b[0m'), 'Should print success symbol');
    assert.ok(output.includes('Done testing'), 'Should print success text');
    assert.ok(output.includes('\x1B[?25h'), 'Should show cursor');
  });

  test('should update text while running', async () => {
    output = '';
    const spinner = new TerminalSpinner();
    spinner.start('Init');
    assert.ok(output.includes('Init'));
    
    spinner.update('Progressing');
    assert.ok(output.includes('Progressing'));
    
    spinner.fail('Failed');
    assert.ok(output.includes('\x1b[31m✖\x1b[0m'), 'Should print fail symbol');
    assert.ok(output.includes('Failed'), 'Should print fail text');
  });
});
