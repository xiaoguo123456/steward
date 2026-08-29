import assert from 'node:assert/strict';
import test from 'node:test';

import { HOME_FEATURE_PREVIEWS, HOME_TOP_TABS } from './home-top-navigation.ts';

test('首页顶部导航保持固定顺序和短标签', () => {
  assert.deepEqual(
    HOME_TOP_TABS.map(({ id, label }) => [id, label]),
    [
      ['today', '今天'],
      ['memories', '时光'],
      ['relationships', '亲友'],
      ['footprints', '足迹'],
      ['mood', '心情'],
    ],
  );
});

test('未开放分区明确说明当前不读取或分析用户资料', () => {
  assert.match(HOME_FEATURE_PREVIEWS.memories.message, /不会读取相册/);
  assert.match(HOME_FEATURE_PREVIEWS.relationships.message, /不会读取通讯录/);
  assert.match(HOME_FEATURE_PREVIEWS.relationships.message, /不会.*调用 AI/);
  assert.match(HOME_FEATURE_PREVIEWS.footprints.message, /不会申请定位/);
  assert.match(HOME_FEATURE_PREVIEWS.mood.message, /不会保存或分析心情内容/);
});
