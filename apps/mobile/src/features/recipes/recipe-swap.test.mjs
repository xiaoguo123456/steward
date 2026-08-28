import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nextSwapRecipe, replaceDishInPlan } from './recipe-swap.ts';

function recipe(id, mealSlots, component) {
  return { id, mealSlots, component };
}

test('换一道只选择同餐次且同角色的菜', () => {
  const recipes = [
    recipe('早餐主食-a', ['breakfast'], 'staple'),
    recipe('早餐荤菜', ['breakfast'], 'protein'),
    recipe('午餐主食', ['lunch'], 'staple'),
    recipe('早餐主食-b', ['breakfast'], 'staple'),
  ];

  assert.equal(
    nextSwapRecipe(recipes, '早餐主食-a', 'breakfast', 'staple')?.id,
    '早餐主食-b',
  );
});

test('换一道不会选中同一餐已经存在的菜', () => {
  const recipes = [
    recipe('主食-a', ['breakfast'], 'staple'),
    recipe('主食-b', ['breakfast'], 'staple'),
    recipe('主食-c', ['breakfast'], 'staple'),
  ];

  assert.equal(
    nextSwapRecipe(recipes, '主食-a', 'breakfast', 'staple', ['主食-b'])?.id,
    '主食-c',
  );
});

test('替换菜单返回新对象并保留原菜品角色', () => {
  const plan = {
    '2026-08-28': {
      breakfast: [{ recipeId: '旧菜', component: 'staple' }],
      lunch: [],
      dinner: [],
    },
  };

  const next = replaceDishInPlan(plan, '2026-08-28', 'breakfast', 0, '新菜');

  assert.notEqual(next, plan);
  assert.equal(plan['2026-08-28'].breakfast[0].recipeId, '旧菜');
  assert.deepEqual(next['2026-08-28'].breakfast[0], {
    recipeId: '新菜',
    component: 'staple',
  });
});
