import { generateDiffPreview } from '../src/tools/diff.js';
import assert from 'node:assert';

const originalFile = 'export PATH="$HOME/.local/bin:$PATH"\nexport EDITOR="nano"';
const modifiedFile = 'export PATH="$HOME/.local/bin:$PATH"\nexport EDITOR="vim"';

const diffOutput = generateDiffPreview(originalFile, modifiedFile);

assert(diffOutput.includes('\x1b[31m- export EDITOR="nano"'), 'Diff preview must display removals in red ANSI formatting.');
assert(diffOutput.includes('\x1b[32m+ export EDITOR="vim"'), 'Diff preview must display insertions in green ANSI formatting.');
console.log('✅ Stage 4 Test Passed: Visual diff generator safely maps removals and insertions.');
