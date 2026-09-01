import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('专注先完成正式任务并等待记录保存，失败时保留总结页', async () => {
  const screen = await read('../app/focus.tsx');
  const context = await read('./focus/focus-context.tsx');
  assert.match(screen, /await updateTask\(/);
  assert.match(screen, /await saveRecord\(/);
  assert.match(screen, /setSaveFailure\(errorMessage/);
  assert.match(context, /tracker\.saveAsync/);
});

test('运动常亮参数进入进行中页且总结等待正式保存', async () => {
  const prepare = await read('../app/features/exercise/[mode]/prepare.tsx');
  const active = await read('../app/features/exercise/[mode]/active.tsx');
  const summary = await read('../app/features/exercise/[mode]/summary.tsx');
  assert.match(prepare, /awake: keepScreenAwake \? '1' : '0'/);
  assert.match(active, /useKeepAwake\('steward-workout'\)/);
  assert.match(summary, /await workout\.saveAsync/);
  assert.match(summary, /运动记录保存失败/);
});

test('购物写入等待成功，读取和写入失败都有可恢复状态', async () => {
  const hook = await read('./shopping/use-shopping-list.ts');
  const content = await read('./shopping/shopping-content.tsx');
  assert.match(hook, /createTask\.mutateAsync/);
  assert.match(hook, /updateTaskMutation\.mutateAsync/);
  assert.match(content, /await shopping\.create/);
  assert.match(content, /购物清单加载失败/);
  assert.match(content, /failure=\{failure\}/);
});

test('重要日、行程与 AI 设置不再把查询失败伪装成空状态', async () => {
  const importantDates = await read('./important-dates/important-dates-content.tsx');
  const trips = await read('./trips/use-trips.ts');
  const ai = await read('../app/settings/ai.tsx');
  assert.match(importantDates, /if \(importantDates\.isError\)/);
  assert.match(trips, /failed: projects\.isError/);
  assert.match(trips, /itinerary\.error\.status === 404/);
  assert.match(ai, /settings\.isError/);
});

test('复盘总是展示确定性指标并等待感受保存', async () => {
  const content = await read('./review/review-content.tsx');
  const hook = await read('./review/use-weekly-review.ts');
  assert.match(content, /!review\.loading && review\.hasReviewableData/);
  assert.doesNotMatch(content, /!review\.narrative && review\.hasReviewableData/);
  assert.match(content, /await review\.saveReflection/);
  assert.match(hook, /saveReflection\.mutateAsync/);
  assert.match(hook, /review\.error \? errorMessage/);
});

test('心情隐私字段双向接入契约且花园节点可以打开日记', async () => {
  const editor = await read('./mood-journal/mood-editor.tsx');
  const create = await read('../app/mood-journal/new.tsx');
  const detail = await read('../app/mood-journal/[id].tsx');
  const garden = await read('../app/mood-journal/garden.tsx');
  for (const source of [editor, create, detail]) {
    assert.match(source, /contextWords|context_words/);
    assert.match(source, /excludeFromAi|exclude_from_ai/);
    assert.match(source, /includeInMemories|include_in_memories/);
  }
  assert.match(garden, /onSelect=\{\(index\)/);
  assert.match(garden, /pathname: '\/mood-journal\/\[id\]'/);
});
