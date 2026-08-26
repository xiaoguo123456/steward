import assert from 'node:assert/strict';
import test from 'node:test';

import { changedTaskListPositions, moveTaskList } from './task-list-order.ts';

const lists = [
  { id: 'default', position: 0 },
  { id: 'work', position: 1 },
  { id: 'life', position: 2 },
];

test('清单可以拖到新的位置', () => {
  assert.deepEqual(
    moveTaskList(lists, 'life', 0).map((list) => list.id),
    ['life', 'default', 'work'],
  );
});

test('目标位置会限制在清单范围内', () => {
  assert.deepEqual(
    moveTaskList(lists, 'default', 99).map((list) => list.id),
    ['work', 'life', 'default'],
  );
});

test('只提交发生变化的位置', () => {
  const reordered = moveTaskList(lists, 'work', 2);
  assert.deepEqual(
    changedTaskListPositions(reordered).map(({ list, position }) => [list.id, position]),
    [['life', 1], ['work', 2]],
  );
});
