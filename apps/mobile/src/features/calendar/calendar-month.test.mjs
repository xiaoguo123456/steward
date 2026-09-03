import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildCalendarMonthCells,
  buildCalendarWeekCells,
  calendarCellPreview,
  calendarMonthRange,
  calendarWeekRange,
  dateKeyForSelectedMonth,
  formatCalendarCellTitle,
  formatCalendarDayTitle,
  formatCalendarMonthTitle,
  formatCalendarWeekTitle,
  shiftCalendarDateKey,
} from './calendar-month.ts';

test('月历总是生成包含相邻月份的 42 个日期格', () => {
  const cells = buildCalendarMonthCells(new Date(2026, 7, 1));
  assert.equal(cells.length, 42);
  assert.equal(cells[0].date, '2026-07-26');
  assert.equal(cells[41].date, '2026-09-05');
  assert.deepEqual(calendarMonthRange(new Date(2026, 7, 1)), {
    from: '2026-07-26',
    to: '2026-09-05',
  });
});

test('选择本月时回到今天，其他月份默认选择一号', () => {
  const today = new Date(2026, 7, 27);
  assert.equal(dateKeyForSelectedMonth(new Date(2026, 7, 1), today), '2026-08-27');
  assert.equal(dateKeyForSelectedMonth(new Date(2026, 8, 1), today), '2026-09-01');
});

test('月份入口显示完整年月，当天面板显示星期', () => {
  assert.equal(formatCalendarMonthTitle(new Date(2026, 7, 1)), '2026年08月');
  assert.equal(formatCalendarDayTitle('2026-08-27'), '8月27日 · 周四');
});

test('月格只保留第一条可读预览，不显示其余条目数量', () => {
  assert.equal(calendarCellPreview(['团队周会']), '团队周会');
  assert.equal(calendarCellPreview(['团队周会', '洗衣服', '准备材料']), '团队周会');
  assert.equal(calendarCellPreview([]), undefined);
});

test('月格标题只保留前四个字且不追加省略号', () => {
  assert.equal(formatCalendarCellTitle('团队周会'), '团队周会');
  assert.equal(formatCalendarCellTitle('准备评审材料'), '准备评审');
  assert.equal(formatCalendarCellTitle('朋友生日🎂提醒'), '朋友生日');
});

test('周历生成周日至周六七天并支持跨周导航', () => {
  const cells = buildCalendarWeekCells('2026-08-28');
  assert.equal(cells.length, 7);
  assert.equal(cells[0].date, '2026-08-23');
  assert.equal(cells[6].date, '2026-08-29');
  assert.deepEqual(calendarWeekRange('2026-08-28'), {
    from: '2026-08-23',
    to: '2026-08-29',
  });
  assert.equal(shiftCalendarDateKey('2026-08-28', 7), '2026-09-04');
  assert.equal(formatCalendarWeekTitle('2026-08-28'), '8月23日—29日');
  assert.equal(formatCalendarWeekTitle('2026-09-01'), '8月30日—9月5日');
});

test('时光与心情复用月历导航和日期格，内容标记保持在日期圈内', async () => {
  const navigator = await readFile(new URL('./calendar-month-navigator.tsx', import.meta.url), 'utf8');
  const grid = await readFile(new URL('./calendar-month-grid.tsx', import.meta.url), 'utf8');
  const memories = await readFile(new URL('../../app/memories/calendar.tsx', import.meta.url), 'utf8');
  const mood = await readFile(new URL('../mood-journal/mood-calendar.tsx', import.meta.url), 'utf8');
  const moodScreen = await readFile(new URL('../../app/mood-journal/calendar.tsx', import.meta.url), 'utf8');

  assert.match(navigator, /<ModalSheet/);
  assert.match(memories, /<CalendarMonthNavigator/);
  assert.match(memories, /<CalendarMonthGrid/);
  assert.doesNotMatch(memories, /memoryDot|styles\.dayCircle|styles\.monthOption/);
  assert.match(moodScreen, /<CalendarMonthNavigator/);
  assert.match(mood, /<CalendarMonthGrid/);
  assert.doesNotMatch(mood, /countBadge|indicator="count"/);
  assert.match(grid, /<View style=\{\[\s*styles\.dayCircle/);
  assert.match(grid, /count > 0 \? \(\s*<View style=\{\[styles\.dot/s);
  assert.match(grid, /styles\.dot[\s\S]*position: 'absolute',[\s\S]*bottom: 5/);
});
