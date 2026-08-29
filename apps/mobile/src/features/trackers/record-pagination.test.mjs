import assert from 'node:assert/strict';
import test from 'node:test';

import { collectCursorPages } from './record-pagination.ts';

test('完整统计会沿不透明游标加载所有记录页', async () => {
  const cursors = [];
  const rows = await collectCursorPages(async (cursor) => {
    cursors.push(cursor ?? null);
    if (!cursor) return { data: [1, 2], page: { next_cursor: 'page-2' } };
    if (cursor === 'page-2') return { data: [3], page: { next_cursor: 'page-3' } };
    return { data: [4], page: { next_cursor: null } };
  }, true);

  assert.deepEqual(cursors, [null, 'page-2', 'page-3']);
  assert.deepEqual(rows, [1, 2, 3, 4]);
});

test('普通列表默认只读取第一页', async () => {
  let calls = 0;
  const rows = await collectCursorPages(async () => {
    calls += 1;
    return { data: [1, 2], page: { next_cursor: 'page-2' } };
  });

  assert.equal(calls, 1);
  assert.deepEqual(rows, [1, 2]);
});

test('重复游标会中止，避免异常响应造成无限请求', async () => {
  await assert.rejects(
    collectCursorPages(async () => ({
      data: [1],
      page: { next_cursor: 'same-cursor' },
    }), true),
    /分页游标重复/,
  );
});
