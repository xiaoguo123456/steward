import assert from 'node:assert/strict';
import test from 'node:test';

import {
  nextTaskListColor,
  resolveTaskListAppearance,
  suggestTaskListIcon,
} from './task-list-appearance.ts';

test('默认清单始终使用收件箱图标', () => {
  assert.deepEqual(
    resolveTaskListAppearance({ name: '默认清单', is_default: true }),
    { icon: 'inbox', color: 'green' },
  );
});

test('新清单根据名称推荐语义图标', () => {
  assert.equal(suggestTaskListIcon('工作项目'), 'work');
  assert.equal(suggestTaskListIcon('下次旅行'), 'travel');
  assert.equal(suggestTaskListIcon('随手记'), 'general');
});

test('新清单优先使用尚未出现的颜色', () => {
  assert.equal(nextTaskListColor([
    { name: '默认清单', is_default: true, color: 'green' },
    { name: '工作', color: 'blue' },
  ]), 'orange');
});

test('旧清单缺少外观字段时结果保持稳定', () => {
  const legacy = { id: 'legacy-list', name: '学习计划' };
  assert.deepEqual(resolveTaskListAppearance(legacy), resolveTaskListAppearance(legacy));
  assert.equal(resolveTaskListAppearance(legacy).icon, 'study');
});
