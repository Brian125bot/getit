import test from 'node:test';
import assert from 'node:assert';
import { configureRuntimeSession, getRuntimeSession, startPromptTransaction } from '../src/runtime/session.js';
import { dispatchToolCall } from '../src/tools/registry.js';
import { renderRoadmap } from '../src/planning/plan-queue.js';

test('Phase 2 dry-run queues mutating tool calls without executing them', async () => {
  configureRuntimeSession({ dryRun: true });
  startPromptTransaction();
  const result = await dispatchToolCall('execute_bash', { command: 'echo should-not-run' });
  assert.strictEqual(result.haltTurn, false);
  const queue = getRuntimeSession().planQueue;
  assert.strictEqual(queue.mutations().length, 1);
  const roadmap = renderRoadmap(queue);
  assert.ok(roadmap.includes('echo should-not-run'));
});
