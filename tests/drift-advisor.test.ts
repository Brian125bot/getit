import test from 'node:test';
import assert from 'node:assert';
import { getDriftAdvice } from '../src/workspace/drift-advisor.js';
import { setChatRequestMock } from '../src/agent/client.js';

test('Phase 3 Advisor: provide actionable drift advice via mock LLM', async () => {
  // Set up the mock response
  setChatRequestMock(async (messages, tools) => {
    return {
      content: '• Looks good\n• No secrets leaked',
      toolCalls: []
    };
  });

  try {
    const advice = await getDriftAdvice('src/test.ts', 'console.log("hello");', '+console.log("hello");');
    assert.strictEqual(advice, '• Looks good\n• No secrets leaked', 'Advice should match mock output');
  } finally {
    // Clean up mock
    setChatRequestMock(null as any);
  }
});

test('Phase 3 Advisor: handles LLM error gracefully', async () => {
  // Set up the mock to throw
  setChatRequestMock(async () => {
    throw new Error('API down');
  });

  try {
    const advice = await getDriftAdvice('src/test.ts', '...', '...');
    assert.ok(advice.includes('Error generating drift advice: API down'), 'Should return formatted error message');
  } finally {
    // Clean up mock
    setChatRequestMock(null as any);
  }
});
