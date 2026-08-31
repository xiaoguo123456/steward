import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  formatMemoryDateParts,
  groupMemoryMoments,
  isMemoryDateKey,
  memoriesForDate,
  memoryDatesWithCounts,
  toMemoryMoment,
} from './memory-model.ts';
import { MEMORY_PHOTO_LIMIT, mergeMemoryPhotos, moveMemoryPhoto } from './memory-picker.ts';

const photo = (id) => ({ id, source: { uri: `file://${id}.jpg` }, description: id });
const moment = (id, date) => ({
  id,
  date,
  description: id,
  photos: [photo(`${id}-photo`)],
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

test('正式接口结果按 position 映射为短期网络图片', () => {
  const mapped = toMemoryMoment({
    id: 'mom_1',
    occurred_on: '2026-08-24',
    description: '傍晚的风很轻。',
    created_by: 'user',
    created_at: '2026-08-24T12:00:00Z',
    photos: [
      { media_id: 'med_2', read_url: 'https://example.test/2', description: '第二张', position: 1 },
      { media_id: 'med_1', read_url: 'https://example.test/1', description: '第一张', position: 0 },
    ],
  });
  assert.deepEqual(mapped.photos.map((item) => item.id), ['med_1', 'med_2']);
  assert.deepEqual(mapped.photos[0].source, { uri: 'https://example.test/1' });
});

test('时光使用正式查询与上传，发布后只保留整段删除', async () => {
  const home = await readFile(new URL('./memories-home.tsx', import.meta.url), 'utf8');
  const editor = await readFile(new URL('../../app/memories/new.tsx', import.meta.url), 'utf8');
  const calendar = await readFile(new URL('../../app/memories/calendar.tsx', import.meta.url), 'utf8');
  const detail = await readFile(new URL('../../app/memories/[id].tsx', import.meta.url), 'utf8');

  assert.match(home, /useListMemoryMoments/);
  assert.match(home, /label="按日期"/);
  assert.match(home, /label="选照片"/);
  assert.match(home, /params: \{ pick: '1' \}/);
  assert.doesNotMatch(home, /name="add"/);
  assert.match(editor, /rawPick !== '1'/);
  assert.match(editor, /void pickImages\(\)/);
  assert.match(editor, /createMemoryMoment/);
  assert.match(editor, /useMediaUpload/);
  assert.match(editor, /<Field label="描述">/);
  assert.doesNotMatch(editor, /<Field label="日期"|<Field label="标题|故事（选填）|发布后不可编辑/);
  assert.doesNotMatch(editor, /AI Candidate|本地交互原型|updateMoment|保存修改/);
  assert.match(calendar, /params: \{ pick: '1' \}/);
  assert.doesNotMatch(calendar, /params: \{ date: selectedDate/);
  assert.match(calendar, />选照片<\/Text>/);
  assert.match(detail, /deleteMemoryMoment/);
  assert.doesNotMatch(detail, /编辑照片与文字|create-outline|memories\/new/);
  assert.doesNotMatch(detail, /本地演示内容|本次运行中添加/);
});
