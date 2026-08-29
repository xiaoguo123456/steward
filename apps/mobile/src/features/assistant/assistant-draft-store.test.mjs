import assert from 'node:assert/strict';
import test from 'node:test';

import { stageAssistantDraft, takeAssistantDraft } from './assistant-draft-store.ts';

test('Assistant 草稿只消费一次且不会持久化', () => {
  stageAssistantDraft({
    text: '',
    contextLabel: '来自《一次散步》',
    surface: 'inspiration',
    openingPrompt: '现在最想继续想哪一部分？',
    firstTurnContext: '请先检索这篇笔记。',
  });

  assert.deepEqual(takeAssistantDraft(), {
    text: '',
    contextLabel: '来自《一次散步》',
    surface: 'inspiration',
    openingPrompt: '现在最想继续想哪一部分？',
    firstTurnContext: '请先检索这篇笔记。',
  });
  assert.equal(takeAssistantDraft(), null);
});
