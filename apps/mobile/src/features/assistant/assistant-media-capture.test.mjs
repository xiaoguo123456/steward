import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assistantCaptureDraftSummary,
  buildAssistantCaptureParts,
} from './assistant-media-capture.ts';

test('AI 图片按文字在前、图片在后的可追溯顺序提交', () => {
  assert.deepEqual(
    buildAssistantCaptureParts('  只整理第一张  ', [
      { mediaId: 'media_1', kind: 'image' },
      { mediaId: 'media_2', kind: 'image' },
    ]),
    [
      { kind: 'text', text: '只整理第一张' },
      { kind: 'image', media_id: 'media_1' },
      { kind: 'image', media_id: 'media_2' },
    ],
  );
});

test('没有说明时使用图片数量作为对话内处理摘要', () => {
  assert.equal(assistantCaptureDraftSummary(' ', 2), '2 张图片');
  assert.equal(assistantCaptureDraftSummary('识别日程', 2), '识别日程');
});
