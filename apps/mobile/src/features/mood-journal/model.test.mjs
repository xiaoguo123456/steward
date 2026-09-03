import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  blocksPlaintext,
  compactMoodJournalDraft,
  createBlocksDocument,
  monthRange,
  mostFrequentMood,
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

test('月范围覆盖当地自然月', () => {
  assert.deepEqual(monthRange(new Date(2026, 1, 10, 12)), {
    from: '2026-02-01',
    to: '2026-02-28',
  });
});

test('常见心情选择不修改服务端原顺序并兼容 Android 运行时', () => {
  const distribution = [
    { mood_level: 'neutral', count: 2 },
    { mood_level: 'good', count: 5 },
    { mood_level: 'very_good', count: 5 },
  ];
  const originalOrder = distribution.map((item) => item.mood_level);

  assert.equal(mostFrequentMood(distribution)?.mood_level, 'good');
  assert.deepEqual(distribution.map((item) => item.mood_level), originalOrder);
  assert.equal(mostFrequentMood([]), undefined);
});

test('新日记按实际保存时间归档，独立日期查找页只读浏览', async () => {
  const content = await readFile(new URL('./mood-journal-content.tsx', import.meta.url), 'utf8');
  const calendar = await readFile(new URL('./mood-calendar.tsx', import.meta.url), 'utf8');
  const calendarScreen = await readFile(new URL('../../app/mood-journal/calendar.tsx', import.meta.url), 'utf8');
  const createScreen = await readFile(new URL('../../app/mood-journal/new.tsx', import.meta.url), 'utf8');
  const layout = await readFile(new URL('../../app/_layout.tsx', import.meta.url), 'utf8');

  assert.match(content, /label="搜索日记"/);
  assert.match(content, /label="按日期"/);
  assert.match(content, /router\.push\('\/mood-journal\/calendar'\)/);
  assert.match(content, /toolsRow:\s*\{[^}]*minHeight:\s*44,[^}]*alignItems:\s*'center'/s);
  assert.match(content, /searchButton:\s*\{[^}]*flex:\s*1,[^}]*justifyContent:\s*'flex-start'/s);
  assert.doesNotMatch(content, /calendarExpanded|<MoodCalendar/);
  assert.doesNotMatch(content, /recentSevenDays|dateRail|calendarSection/);
  assert.match(layout, /name="mood-journal\/calendar"/);
  assert.match(calendar, /useGetMoodJournalCalendar/);
  assert.match(calendarScreen, /<MoodCalendar/);
  assert.match(calendarScreen, /useListMoodJournalEntries/);
  assert.match(calendarScreen, /<CalendarMonthNavigator/);
  assert.match(calendarScreen, /entriesQuery\.isPending/);
  assert.match(calendarScreen, /entriesQuery\.isError/);
  assert.match(calendarScreen, /entries\.length > 0/);
  assert.match(calendarScreen, /这一天还没有记录/);
  assert.doesNotMatch(calendarScreen, /写日记|补写|mood-journal\/new/);
  assert.match(content, /router\.push\('\/mood-journal\/new'\)/);
  assert.doesNotMatch(content, /补写|initialDate|params: \{ date:/);
  assert.match(createScreen, /occurred_at: new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(createScreen, /useLocalSearchParams|dateTimeForEntry|parseLocalDateKey|localDateKey/);
  assert.match(calendar, /day\.count/);
  assert.doesNotMatch(calendar, /fixture|__DEV__/i);
});
