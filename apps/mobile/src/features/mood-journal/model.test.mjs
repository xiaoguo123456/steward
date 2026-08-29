import assert from 'node:assert/strict';
import test from 'node:test';

import {
  blocksPlaintext,
  createBlocksDocument,
  dateTimeForEntry,
  localDateKey,
  monthRange,
  recentSevenDays,
} from './model.ts';

test('块文档只维护一份权威正文并可生成本地预览', () => {
  const document = createBlocksDocument('第一段');
  document.blocks.push({ id: 'blk_2', type: 'quote', runs: [{ text: '第二段' }] });
  assert.equal(blocksPlaintext(document), '第一段\n第二段');
});

test('最近七天保持从旧到新的连续日期', () => {
  const days = recentSevenDays(new Date(2026, 7, 28, 12));
  assert.equal(days.length, 7);
  assert.equal(days[0].key, '2026-08-22');
  assert.equal(days[6].key, '2026-08-28');
});

test('月范围覆盖当地自然月', () => {
  assert.deepEqual(monthRange(new Date(2026, 1, 10, 12)), {
    from: '2026-02-01',
    to: '2026-02-28',
  });
});

test('补写日期保留当前时刻但使用目标当地日期', () => {
  const result = new Date(dateTimeForEntry('2026-08-20', new Date(2026, 7, 28, 21, 35)));
  assert.equal(localDateKey(result), '2026-08-20');
  assert.equal(result.getHours(), 21);
  assert.equal(result.getMinutes(), 35);
});
