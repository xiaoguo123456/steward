import assert from 'node:assert/strict';
import test from 'node:test';

import { HOME_FEATURE_PREVIEWS, HOME_TOP_TABS } from './home-top-navigation.ts';

test('首页顶部导航保持固定顺序和短标签', () => {
  assert.deepEqual(
    HOME_TOP_TABS.map(({ id, label }) => [id, label]),
    [
      ['today', '今天'],
      ['memories', '时光'],
      ['music', '音乐'],
      ['footprints', '足迹'],
      ['mood', '心情'],
    ],
  );
});

test('仍未开放的分区明确说明当前不读取或分析用户资料', () => {
  assert.equal('memories' in HOME_FEATURE_PREVIEWS, false);
  assert.match(HOME_FEATURE_PREVIEWS.music.message, /不会播放或生成音频/);
  assert.match(HOME_FEATURE_PREVIEWS.footprints.message, /不会申请定位/);
  assert.match(HOME_FEATURE_PREVIEWS.mood.message, /不会保存或分析心情内容/);
});
