import assert from 'node:assert/strict';
import test from 'node:test';

import { selectDailyInspirationNote } from './inspiration-selection.ts';

function note(id, updatedAt, deletedAt = null) {
  return {
    id,
    type: 'note',
    title: `笔记 ${id}`,
    content: '正文',
    tags: [],
    created_by: 'user',
    created_at: updatedAt,
    updated_at: updatedAt,
    deleted_at: deletedAt,
    version: 1,
  };
}

test('只从已沉淀至少七天且未删除的笔记中选择', () => {
  const selected = selectDailyInspirationNote(
    [
      note('old', '2026-08-01T08:00:00Z'),
      note('recent', '2026-08-26T08:00:00Z'),
      note('deleted', '2026-07-01T08:00:00Z', '2026-08-02T08:00:00Z'),
    ],
    '2026-08-28',
  );

  assert.equal(selected?.id, 'old');
});

test('同一天对同一组笔记保持稳定选择', () => {
  const notes = [
    note('a', '2026-07-01T08:00:00Z'),
    note('b', '2026-07-02T08:00:00Z'),
    note('c', '2026-07-03T08:00:00Z'),
  ];

  assert.equal(
    selectDailyInspirationNote(notes, '2026-08-28')?.id,
    selectDailyInspirationNote([...notes].reverse(), '2026-08-28')?.id,
  );
});

test('没有符合条件的真实笔记时返回空状态', () => {
  assert.equal(
    selectDailyInspirationNote([note('recent', '2026-08-27T08:00:00Z')], '2026-08-28'),
    null,
  );
  assert.equal(selectDailyInspirationNote([], 'invalid-date'), null);
});
