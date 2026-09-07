import assert from 'node:assert/strict';
import test from 'node:test';
import { assistantOperationState } from './assistant-operation-state.ts';

test('断网及恢复过程中保持轮次活跃，不重复发送', () => {
  for (const status of [undefined, 'queued', 'running']) {
    assert.deepEqual(assistantOperationState(status, true), { settled: false, recovering: true });
    assert.deepEqual(assistantOperationState(status, false), { settled: false, recovering: false });
  }
});
test('只有服务端终态结束等待，即使后续请求暂时出错', () => {
  for (const status of ['succeeded', 'failed', 'cancelled']) {
    assert.deepEqual(assistantOperationState(status, true), { settled: true, recovering: false });
  }
});
