import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { GetCaptureResponse } from '../../../../../packages/api-client/src/generated/captures/captures.zod.ts';
import { captureConversationPhase } from './capture-conversation-model.ts';

const fixture = JSON.parse(readFileSync(new URL('../../../../../packages/contracts/fixtures/capture-weight.response.json', import.meta.url), 'utf8'));

test('体重记录的完整关联候选可通过正式网络校验并进入确认', () => {
  const response = GetCaptureResponse.parse(fixture);
  const [tracker, record] = response.data.candidates;
  assert.equal(record.payload.record.tracker_ref, tracker.id);
  assert.equal(tracker.payload.tracker.fields[0].unit, 'kg');
  assert.equal(record.payload.record.values[0].number_value, 68.5);
  assert.equal(captureConversationPhase({ captureStatus: response.data.status, operationStatus: 'succeeded' }), 'confirmation');
});

test('复现旧空字段响应被拒后，旧缓存必须进入可重试状态', () => {
  const broken = structuredClone(fixture);
  broken.data.candidates[0].payload.tracker.fields = null;
  assert.equal(GetCaptureResponse.safeParse(broken).success, false);
  assert.equal(captureConversationPhase({ captureStatus: 'parsing', operationStatus: 'succeeded', captureFailed: true }), 'unavailable');
});
