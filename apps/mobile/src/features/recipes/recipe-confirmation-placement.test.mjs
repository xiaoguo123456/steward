import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('新生成的周食谱在菜单顶部提供醒目的确认入口', async () => {
  const source = await readFile(
    new URL('../../app/features/recipes/index.tsx', import.meta.url),
    'utf8',
  );
  const noticeIndex = source.indexOf('style={styles.pendingPlanNotice}');
  const menuTitleIndex = source.indexOf('<RecipeSectionTitle');
  const bottomActionsIndex = source.indexOf('style={styles.homeActions}');

  assert.ok(noticeIndex > 0, '需要渲染顶部待确认提示');
  assert.ok(noticeIndex < menuTitleIndex, '确认入口需要出现在菜单内容之前');
  assert.ok(menuTitleIndex < bottomActionsIndex, '底部操作区只保留后续操作');
  assert.match(source.slice(noticeIndex, menuTitleIndex), /label=\{planSaving \? '正在确认…' : '确认食谱'\}/);
  assert.doesNotMatch(source.slice(bottomActionsIndex), /确认食谱/);
});
