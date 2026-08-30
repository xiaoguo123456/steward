import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildPrototypeWritingCandidate,
  formatMemoryDateParts,
  groupMemoryMoments,
  isMemoryDateKey,
  memoriesForDate,
  memoryDatesWithCounts,
} from './memory-model.ts';
import { MEMORY_PHOTO_LIMIT, mergeMemoryPhotos, moveMemoryPhoto } from './memory-picker.ts';

const photo = (id) => ({ id, source: { uri: `file://${id}.jpg` }, description: id });
const moment = (id, date) => ({
  id,
  date,
  title: id,
  story: '',
  photos: [photo(`${id}-photo`)],
  origin: 'local',
});

test('时光按月份和日期由新到旧分组，同一天可以保留多条', () => {
  const groups = groupMemoryMoments([
    moment('older', '2026-07-30'),
    moment('same-a', '2026-08-24'),
    moment('newer', '2026-08-28'),
    moment('same-b', '2026-08-24'),
  ]);
  assert.deepEqual(groups.map((group) => group.key), ['2026-08', '2026-07']);
  assert.deepEqual(groups[0].moments.map((item) => item.id), ['newer', 'same-b', 'same-a']);
  assert.equal(memoriesForDate(groups[0].moments, '2026-08-24').length, 2);
  assert.equal(memoryDatesWithCounts(groups[0].moments).get('2026-08-24'), 2);
});

test('日期展示包含星期且拒绝不存在的日期', () => {
  assert.deepEqual(formatMemoryDateParts('2026-08-24'), {
    day: '24',
    weekday: '周一',
    month: '8月',
    full: '2026年8月24日 · 周一',
  });
  assert.equal(isMemoryDateKey('2026-08-24'), true);
  assert.equal(isMemoryDateKey('2026-02-30'), false);
  assert.equal(isMemoryDateKey('2026/08/24'), false);
});

test('选图去重并严格限制为九张，排序不会越界', () => {
  const incoming = Array.from({ length: 12 }, (_, index) => photo(`photo-${index}`));
  const merged = mergeMemoryPhotos([photo('photo-0')], incoming);
  assert.equal(merged.length, MEMORY_PHOTO_LIMIT);
  assert.equal(new Set(merged.map((item) => item.id)).size, MEMORY_PHOTO_LIMIT);
  assert.deepEqual(moveMemoryPhoto(merged, 1, -1).slice(0, 2).map((item) => item.id), ['photo-1', 'photo-0']);
  assert.deepEqual(moveMemoryPhoto(merged, 0, -1), merged);
});

test('原型文案只生成候选并保留可追溯的输入摘要', () => {
  assert.deepEqual(buildPrototypeWritingCandidate({
    date: '2026-08-24',
    photoCount: 4,
    title: '',
    story: '',
  }), {
    title: '8月24日的片段',
    story: '翻到这 4 张照片，才发现普通的一天也有值得记住的光。',
    sourceSummary: '4 张已选照片 · 2026-08-24',
  });
});

test('时光首页使用明确的上下文动作并直接进入系统选图', async () => {
  const home = await readFile(new URL('./memories-home.tsx', import.meta.url), 'utf8');
  const editor = await readFile(new URL('../../app/memories/new.tsx', import.meta.url), 'utf8');
  const calendar = await readFile(new URL('../../app/memories/calendar.tsx', import.meta.url), 'utf8');

  assert.match(home, />按日期<\/Text>/);
  assert.match(home, />选照片<\/Text>/);
  assert.match(home, /params: \{ pick: '1' \}/);
  assert.doesNotMatch(home, /name="add"/);
  assert.match(editor, /rawPick !== '1'/);
  assert.match(editor, /void pickImages\(\)/);
  assert.match(calendar, /params: \{ date: selectedDate, pick: '1' \}/);
  assert.match(calendar, />添加照片<\/Text>/);
});
