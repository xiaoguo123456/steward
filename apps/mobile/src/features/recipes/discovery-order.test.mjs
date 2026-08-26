import assert from 'node:assert/strict';
import { test } from 'node:test';

import { orderDiscoveryRecipes } from './discovery-order.ts';

const recipes = Array.from({ length: 10 }, (_, index) => ({ id: `recipe-${index + 1}` }));

test('同一浏览会话和分类保持相同顺序', () => {
  const first = orderDiscoveryRecipes(recipes, {
    category: 'recommended',
    query: '',
    seed: 20260826,
  });
  const second = orderDiscoveryRecipes(recipes, {
    category: 'recommended',
    query: '',
    seed: 20260826,
  });

  assert.deepEqual(first, second);
  assert.notDeepEqual(first, recipes);
  assert.deepEqual(
    recipes.map((item) => item.id),
    Array.from({ length: 10 }, (_, index) => `recipe-${index + 1}`),
  );
});

test('换分类或刷新种子后得到新的展示顺序', () => {
  const recommended = orderDiscoveryRecipes(recipes, {
    category: 'recommended',
    query: '',
    seed: 12,
  });
  const seasonal = orderDiscoveryRecipes(recipes, {
    category: 'seasonal',
    query: '',
    seed: 12,
  });
  const refreshed = orderDiscoveryRecipes(recipes, {
    category: 'recommended',
    query: '',
    seed: 13,
  });

  assert.notDeepEqual(recommended, seasonal);
  assert.notDeepEqual(recommended, refreshed);
});

test('搜索结果保留服务端返回顺序', () => {
  const ordered = orderDiscoveryRecipes(recipes, {
    category: 'recommended',
    query: '鸡胸肉',
    seed: 99,
  });

  assert.equal(ordered, recipes);
});
