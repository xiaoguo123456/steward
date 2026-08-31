import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { HOME_TOP_TABS } from './home-top-navigation.ts';

test('首页顶部导航保持固定顺序和短标签', () => {
  assert.deepEqual(
    HOME_TOP_TABS.map(({ id, label }) => [id, label]),
    [
      ['today', '今天'],
      ['memories', '时光'],
      ['relationships', '亲友'],
      ['inspiration', '灵感'],
      ['mood', '心情'],
    ],
  );
});

test('亲友回到首页分区且正式构建不展示示例人物', async () => {
  const home = await readFile(new URL('../../app/(tabs)/today.tsx', import.meta.url), 'utf8');
  const relationships = await readFile(
    new URL('../relationships/relationships-content.tsx', import.meta.url),
    'utf8',
  );

  assert.match(home, /activeHomeTab === 'relationships'/);
  assert.match(home, /<RelationshipsContent \/>/);
  assert.match(relationships, /if \(!__DEV__\)/);
  assert.match(relationships, /当前不会读取通讯录、保存人物资料或调用 AI/);
  assert.doesNotMatch(relationships, /界面预览 · 未读取通讯录/);
  assert.doesNotMatch(relationships, /style=\{styles\.pageTitle\}>亲友/);
  assert.doesNotMatch(relationships, /label="添加亲友"/);
  assert.doesNotMatch(relationships, /PreviewNoticeSheet|showPreviewNotice|新增亲友将在正式版开放/);
  assert.doesNotMatch(relationships, /name="add"/);
  assert.match(relationships, /style=\{styles\.toolbarRow\}/);
  assert.doesNotMatch(relationships, /style=\{styles\.actionRow\}/);
});

test('时光与心情首页不展示重复标题或研发提示', async () => {
  const memories = await readFile(new URL('../memories/memories-home.tsx', import.meta.url), 'utf8');
  const mood = await readFile(new URL('../mood-journal/mood-journal-content.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(memories, /本地交互预览，不会上传这些照片/);
  assert.doesNotMatch(mood, />心情日记<\/Text>/);
  assert.doesNotMatch(mood, /今天已写/);
  assert.match(mood, /label="日历"/);
  assert.match(mood, /label="搜索"/);
});

test('首页分区已开放的紧凑操作复用统一按钮及全局操作色', async () => {
  const memories = await readFile(new URL('../memories/memories-home.tsx', import.meta.url), 'utf8');
  const relationships = await readFile(new URL('../relationships/relationships-content.tsx', import.meta.url), 'utf8');
  const inspiration = await readFile(new URL('../inspiration/inspiration-content.tsx', import.meta.url), 'utf8');
  const mood = await readFile(new URL('../mood-journal/mood-journal-content.tsx', import.meta.url), 'utf8');

  for (const source of [memories, inspiration, mood]) {
    assert.match(source, /<AppButton/);
    assert.match(source, /compact/);
  }
  assert.match(memories, /label="按日期"[\s\S]*variant="neutral"/);
  assert.match(memories, /label="选照片"[\s\S]*variant="secondary"/);
  assert.match(relationships, /toolbarRow:\s*\{[^}]*minHeight:\s*44,/s);
  assert.match(relationships, /searchField:\s*\{[^}]*minHeight:\s*44,/s);
  assert.equal((mood.match(/variant="neutral"/g) ?? []).length, 2);
  assert.match(inspiration, /label="开始聊聊"[\s\S]*variant="text"/);
  assert.match(inspiration, /label="打开原文"[\s\S]*variant="textMuted"/);
});
