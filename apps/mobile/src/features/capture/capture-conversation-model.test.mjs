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

test('明确无保存内容的结束态不展示失败或零项确认', () => {
  assert.equal(captureConversationPhase({ captureStatus: 'discarded', operationStatus: 'succeeded' }), 'dismissed');
});

test('整理已结束但结果读取失败时，旧 parsing 缓存不能继续显示处理中', () => {
  assert.equal(captureConversationPhase({
    captureStatus: 'parsing', operationStatus: 'succeeded', captureFailed: true,
  }), 'unavailable');
  assert.equal(captureConversationPhase({
    captureStatus: 'parsing', captureFailed: true,
  }), 'unavailable');
  assert.equal(captureConversationPhase({
    captureStatus: 'needs_confirmation', operationStatus: 'succeeded', captureFailed: true,
  }), 'confirmation');
});

test('失败或读取异常不阻塞后续输入，处理中与待确认仍保留当前输入保护', async () => {
  const { captureBlocksComposer } = await import('./capture-conversation-model.ts');
  for (const phase of ['failure', 'unavailable', 'completed', 'dismissed']) assert.equal(captureBlocksComposer(phase), false);
  for (const phase of [undefined, 'processing', 'clarification', 'confirmation', 'partial_failure']) assert.equal(captureBlocksComposer(phase), true);
});
