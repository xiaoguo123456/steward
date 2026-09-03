import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { HOME_TOP_TABS, resolveHomeEntryTab } from './home-top-navigation.ts';

test('首页顶部导航保持固定顺序和短标签', () => {
  assert.deepEqual(
    HOME_TOP_TABS.map(({ id, label }) => [id, label]),
    [
      ['today', '今天'],
      ['memories', '时光'],
      ['mood', '心情'],
      ['relationships', '亲友'],
    ],
  );
});

test('首次进入首页默认定位到今天，二级页返回时保留离开前的分区', async () => {
  assert.equal(resolveHomeEntryTab(undefined), 'today');
  assert.equal(resolveHomeEntryTab('unknown'), 'today');
  assert.equal(resolveHomeEntryTab('memories'), 'memories');
  assert.equal(resolveHomeEntryTab('mood'), 'mood');
  assert.equal(resolveHomeEntryTab('relationships'), 'relationships');

  const home = await readFile(new URL('../../app/(tabs)/today.tsx', import.meta.url), 'utf8');
  assert.match(home, /useFocusEffect\(/);
  assert.match(home, /if \(params\.homeTab === undefined && params\.date === undefined\) return/);
  assert.match(home, /setActiveHomeTab\(resolveHomeEntryTab\(params\.homeTab\)\)/);
  assert.doesNotMatch(home, /setActiveHomeTab\('today'\)/);
  assert.match(home, /router\.setParams\(\{ homeTab: undefined, date: undefined \}\)/);
});

test('亲友首页使用正式人物查询和添加入口', async () => {
  const home = await readFile(new URL('../../app/(tabs)/today.tsx', import.meta.url), 'utf8');
  const relationships = await readFile(
    new URL('../relationships/relationships-content.tsx', import.meta.url),
    'utf8',
  );

  assert.match(home, /activeHomeTab === 'relationships'/);
  assert.match(home, /<RelationshipsContent \/>/);
  assert.match(relationships, /useListPeople/);
  assert.match(relationships, /router\.push\('\/people\/new'\)/);
  assert.match(relationships, /label="添加"/);
  assert.doesNotMatch(relationships, /previewPeople|__DEV__/);
  assert.doesNotMatch(relationships, /style=\{styles\.pageTitle\}>亲友/);
  assert.doesNotMatch(relationships, /PreviewNoticeSheet|showPreviewNotice|新增亲友将在正式版开放/);
  assert.match(relationships, /style=\{styles\.toolbarRow\}/);
  assert.match(relationships, /page: \{ gap: 18, paddingTop: spacing\.md \}/);
  assert.doesNotMatch(relationships, /style=\{styles\.actionRow\}/);
});

test('亲友详情聚焦人物资料、关联待办、近期安排和重要日', async () => {
  const detail = await readFile(new URL('../../app/people/[id].tsx', import.meta.url), 'utf8');
  const eventForm = await readFile(new URL('../../app/people/[id]/event/new.tsx', import.meta.url), 'utf8');
  const editForm = await readFile(new URL('../../app/people/[id]/edit.tsx', import.meta.url), 'utf8');

  assert.match(detail, /useGetPerson/);
  assert.match(detail, /useListPersonEvents/);
  assert.match(detail, /useListTasks/);
  assert.match(detail, /person_id: personID/);
  assert.doesNotMatch(detail, /useListPersonInteractions|记互动|最近互动/);
  assert.match(detail, /label="添加任务"/);
  assert.match(detail, /label="添加事件"/);
  assert.match(detail, /title="待办"/);
  assert.match(detail, /useToggleTaskDone/);
  assert.match(detail, /accessibilityRole="checkbox"/);
  assert.match(detail, /accessibilityLabel=\{`完成任务：\$\{task\.title\}`\}/);
  assert.match(detail, /title="近期安排"/);
  assert.match(detail, /title="重要日"/);
  assert.match(detail, /event\.event_kind !== 'important_date'/);
  assert.match(detail, /event\.event_kind === 'important_date'/);
  assert.match(eventForm, /kind === 'important_date' \? 1900/);
  assert.match(editForm, /homeTab: 'relationships'/);
});

test('时光与心情首页不展示重复标题或研发提示', async () => {
  const memories = await readFile(new URL('../memories/memories-home.tsx', import.meta.url), 'utf8');
  const mood = await readFile(new URL('../mood-journal/mood-journal-content.tsx', import.meta.url), 'utf8');
  const layout = await readFile(new URL('../../app/_layout.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(memories, /本地交互预览，不会上传这些照片/);
  assert.doesNotMatch(mood, />心情日记<\/Text>/);
  assert.doesNotMatch(mood, /今天已写/);
  assert.match(mood, /label="搜索日记"/);
  assert.match(mood, /label="按日期"/);
  assert.match(mood, /router\.push\('\/mood-journal\/calendar'\)/);
  assert.match(layout, /name="mood-journal\/calendar"/);
  assert.doesNotMatch(mood, /<MoodCalendar|calendarExpanded|recentSevenDays|dateRail|calendarSection/);
});

test('首页分区已开放的紧凑操作复用统一按钮及全局操作色', async () => {
  const memories = await readFile(new URL('../memories/memories-home.tsx', import.meta.url), 'utf8');
  const relationships = await readFile(new URL('../relationships/relationships-content.tsx', import.meta.url), 'utf8');
  const mood = await readFile(new URL('../mood-journal/mood-journal-content.tsx', import.meta.url), 'utf8');

  for (const source of [memories, mood]) {
    assert.match(source, /<AppButton/);
    assert.match(source, /compact/);
  }
  assert.match(memories, /label="按日期"[\s\S]*variant="neutral"/);
  assert.match(memories, /label="选照片"[\s\S]*variant="secondary"/);
  assert.match(relationships, /toolbarRow:\s*\{[^}]*minHeight:\s*44,/s);
  assert.match(relationships, /searchField:\s*\{[^}]*minHeight:\s*44,/s);
  assert.match(relationships, /<AppButton[\s\S]*compact[\s\S]*label="添加"[\s\S]*variant="secondary"/);
  assert.equal((mood.match(/variant="neutral"/g) ?? []).length, 2);
  assert.match(mood, /searchButton:\s*\{[^}]*flex:\s*1,/s);
  assert.match(mood, /toolsRow:\s*\{[^}]*alignItems:\s*'center'[^}]*gap:\s*8/s);
});

test('首页不再保留灵感分区或专属页面入口', async () => {
  const home = await readFile(new URL('../../app/(tabs)/today.tsx', import.meta.url), 'utf8');
  const tabs = await readFile(new URL('./home-top-tabs.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(home, /InspirationContent|activeHomeTab === 'inspiration'/);
  assert.equal(HOME_TOP_TABS.some(({ id }) => id === 'inspiration'), false);
  assert.match(tabs, /tab:\s*\{[^}]*flexGrow:\s*1,/s);
});

test('今天首页只保留待办主区，不用日程数量拼装第二个今日摘要', async () => {
  const home = await readFile(new URL('../../app/(tabs)/today.tsx', import.meta.url), 'utf8');

  assert.match(home, /title="今天要做"/);
  assert.match(home, /scheduled_today: '今天已排期'/);
  assert.match(home, /message="今天没有待办，想到什么就记下来。"/);
  assert.doesNotMatch(home, /title="今日安排"/);
  assert.doesNotMatch(home, /data\.events|events\.length|briefTitle|name="sparkles"/);
});
