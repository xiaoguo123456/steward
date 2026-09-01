import assert from 'node:assert/strict';
import test from 'node:test';

import { applyMoodJournalPolish, canPolishMoodJournal } from './mood-journal-polish.ts';

const content = {
  format: 'blocks_v1',
  version: 1,
  blocks: [{ id: 'blk_1', type: 'paragraph', runs: [{ text: '今天散步了。' }] }],
};

test('心情日记有正文且空闲时才允许排版润色', () => {
  assert.equal(canPolishMoodJournal(content, false), true);
  assert.equal(canPolishMoodJournal(content, true), false);
  assert.equal(canPolishMoodJournal({
    ...content,
    blocks: [{ id: 'blk_1', type: 'paragraph', runs: [{ text: '  ' }] }],
  }, false), false);
});

test('采用排版润色结果时保留 AI 来源', () => {
  const candidate = {
    content: {
      ...content,
      blocks: [{ id: 'blk_1', type: 'quote', runs: [{ text: '今天去散步了。' }] }],
    },
    ai_action_id: 'aia_mood_polish',
  };
  const next = applyMoodJournalPolish(content, candidate);
  assert.equal(next.content.blocks[0].type, 'quote');
  assert.equal(next.polishActionId, 'aia_mood_polish');
});
