import assert from 'node:assert/strict';
import test from 'node:test';

import { applyNotePolish, canPolishNote } from './note-polish.ts';

test('标题为空时采用润色标题，已有标题保持不变', () => {
  const candidate = {
    title: '自动生成的标题',
    content: '更清楚的正文。',
    ai_action_id: 'aia_polish',
  };

  assert.equal(applyNotePolish({ title: '', content: '原文', tags: [] }, candidate).title, '自动生成的标题');
  assert.equal(applyNotePolish({ title: '用户标题', content: '原文', tags: [] }, candidate).title, '用户标题');
});

test('润色结果保留来源，正文为空或处理中不可再次触发', () => {
  const next = applyNotePolish(
    { title: '', content: '原文', tags: ['灵感'] },
    { title: '标题', content: '整理后的正文', ai_action_id: 'aia_polish' },
  );
  assert.equal(next.polishActionId, 'aia_polish');
  assert.deepEqual(next.tags, ['灵感']);
  assert.equal(canPolishNote('  ', false), false);
  assert.equal(canPolishNote('正文', true), false);
  assert.equal(canPolishNote('正文', false), true);
});
