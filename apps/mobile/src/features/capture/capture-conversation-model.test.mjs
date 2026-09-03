import assert from 'node:assert/strict';
import test from 'node:test';

import {
  captureConversationPhase,
  capturePartStatusItems,
  captureProcessingCopy,
} from './capture-conversation-model.ts';

test('Capture 对话阶段覆盖处理中、澄清、确认、失败和完成', () => {
  assert.equal(captureConversationPhase({ operationStatus: 'running' }), 'processing');
  assert.equal(
    captureConversationPhase({ captureFailed: true, operationStatus: 'running' }),
    'processing',
  );
  assert.equal(captureConversationPhase({ captureStatus: 'awaiting_instruction' }), 'clarification');
  assert.equal(captureConversationPhase({ captureStatus: 'needs_confirmation' }), 'confirmation');
  assert.equal(captureConversationPhase({ captureStatus: 'partially_failed' }), 'partial_failure');
  assert.equal(captureConversationPhase({ operationStatus: 'failed' }), 'failure');
  assert.equal(
    captureConversationPhase({ captureStatus: 'needs_confirmation', operationFailed: true }),
    'confirmation',
  );
  assert.equal(captureConversationPhase({ captureStatus: 'confirmed' }), 'completed');
  assert.equal(captureConversationPhase({ captureFailed: true }), 'unavailable');
});

test('处理中提示来自真实 Capture 阶段', () => {
  assert.equal(captureProcessingCopy('submitting'), '正在安全提交你的输入…');
  assert.equal(captureProcessingCopy('preprocessing'), '正在读取文字、语音或图片…');
  assert.equal(captureProcessingCopy('parsing'), '正在整理可确认的结果…');
});

test('多轮文字澄清在处理中聚合为一行，图片仍逐项显示', () => {
  const rows = capturePartStatusItems([
    { id: 'text-original', kind: 'text', position: 0, status: 'succeeded' },
    { id: 'text-answer-1', kind: 'text', position: 1001, status: 'succeeded' },
    { id: 'text-answer-2', kind: 'text', position: 1002, status: 'succeeded' },
    { id: 'image-1', kind: 'image', position: 1, status: 'succeeded' },
    { id: 'image-2', kind: 'image', position: 2, status: 'failed', error: { message: '图片模糊' } },
  ]);

  assert.deepEqual(rows, [
    { key: 'text-context', label: '文字与补充说明', status: 'succeeded', errorMessage: undefined },
    { key: 'image-1', label: '图片 2', status: 'succeeded', errorMessage: undefined },
    { key: 'image-2', label: '图片 3', status: 'failed', errorMessage: '图片模糊' },
  ]);
});
