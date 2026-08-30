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
});
