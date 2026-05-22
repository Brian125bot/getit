import assert from 'node:assert';
import test from 'node:test';
import { AgentLoop } from '../src/agent/loop.js';
import { setChatRequestMock } from '../src/agent/client.js';

test('Stage 3: REPL maintains context over multiple turns', async () => {
  setChatRequestMock(async (messages, tools) => {
    const lastMsg = messages[messages.length - 1]?.content;
    if (lastMsg && lastMsg.includes('Remember token "TEST_KEY_VALID"')) {
      return { content: 'State cached' };
    }
    if (lastMsg && lastMsg.includes('Recall the token name.')) {
      return { content: 'TEST_KEY_VALID' };
    }
    return { content: '' };
  });

  try {
    const agent = new AgentLoop('test system prompt');
    await agent.runTurn('Remember token "TEST_KEY_VALID"');
    await agent.runTurn('Recall the token name.');
    const content = agent.getMessages().map((message) => message.content).join('\n');
    assert(content.includes('TEST_KEY_VALID'), "REPL must maintain context and memory history statefully over multiple turns.");
  } finally {
    setChatRequestMock(null);
  }
});
