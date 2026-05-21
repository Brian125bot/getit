import { buildSystemPrompt } from '../src/agent/prompt.js';
import assert from 'node:assert';
import os from 'node:os';

const prompt = buildSystemPrompt();
const expectedArch = os.arch() === 'x64' ? 'x86_64' : 'arm64';

assert(prompt.includes(expectedArch), `System prompt must explicitly include architecture: ${expectedArch}`);
assert(prompt.includes('curl') || prompt.includes('missing curl'), 'System prompt must log status of network dependencies.');
console.log('✅ Stage 2 Test Passed: Ambient discovery payload generated and appended correctly.');
