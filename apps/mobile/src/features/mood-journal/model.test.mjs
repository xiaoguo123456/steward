import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  blocksPlaintext,
  compactMoodJournalDraft,
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

test('恢复旧草稿时清理手动工具栏遗留的空块', () => {
  const empty = createBlocksDocument();
  empty.blocks.push({ id: 'blk_old_quote', type: 'quote', runs: [{ text: '' }] });
  const compactedEmpty = compactMoodJournalDraft(empty);
  assert.equal(compactedEmpty.blocks.length, 1);
  assert.equal(compactedEmpty.blocks[0].type, 'paragraph');

  const partial = createBlocksDocument('保留这段');
  partial.blocks.push({ id: 'blk_old_empty', type: 'heading_2', runs: [{ text: '  ' }] });
  assert.deepEqual(compactMoodJournalDraft(partial).blocks.map((block) => block.id), [partial.blocks[0].id]);
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

test('心情首页由月份标题切换周视图与正式月历且选择后收起', async () => {
  const content = await readFile(new URL('./mood-journal-content.tsx', import.meta.url), 'utf8');
  const calendar = await readFile(new URL('./mood-calendar.tsx', import.meta.url), 'utf8');

  assert.match(content, /formatCalendarMonthTitle\(visibleMonthAnchor\)/);
  assert.match(content, /accessibilityState=\{\{ expanded: calendarExpanded \}\}/);
  assert.match(content, /styles\.calendarTitleButton/);
  assert.doesNotMatch(content, /calendarDisclosure/);
  assert.doesNotMatch(content, /date === selectedDate[\s\S]*setCalendarExpanded/s);
  assert.match(content, /setCalendarExpanded\(false\)/);
  assert.match(calendar, /useGetMoodJournalCalendar/);
  assert.match(content, /calendarExpanded \? \([\s\S]*<MoodCalendar[\s\S]*\) : \([\s\S]*<ScrollView/s);
  assert.match(content, /monthAnchor=\{calendarMonthAnchor\}/);
  assert.doesNotMatch(calendar, /monthHeader|formatCalendarMonthTitle/);
  assert.match(calendar, /day\.count/);
  assert.doesNotMatch(calendar, /fixture|__DEV__/i);
});
