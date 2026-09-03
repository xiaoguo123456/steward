import assert from 'node:assert/strict';
import test from 'node:test';

import {
  captureConversationPhase,
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
