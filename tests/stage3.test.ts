import assert from 'node:assert';
import test from 'node:test';
import { AgentLoop } from '../src/agent/loop.js';

test('Stage 3: REPL maintains context over multiple turns', async () => {
  process.env.GETIT_TEST_MODE = 'true';
  process.env.GETIT_DISABLE_TEST_EXIT = 'true';
  const agent = new AgentLoop('test system prompt');
  await agent.runTurn('Remember token "TEST_KEY_VALID"');
  await agent.runTurn('Recall the token name.');
  const content = agent.getMessages().map((message) => message.content).join('\n');
  assert(content.includes('TEST_KEY_VALID'), "REPL must maintain context and memory history statefully over multiple turns.");
});
