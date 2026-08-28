import { errorMessage, getMealPlanSuggestion, type Recipe as ApiRecipe } from '@steward/api-client';
import { useCallback, useRef } from 'react';

import type { MealSlot, RecipeComponent } from './model';
import { nextSwapRecipe } from './recipe-swap';
import { toRecipe } from './use-recipe-content';

const maxAttempts = 3;

/**
 * 为单道替换寻找正式菜单候选。
 *
 * 不能从发现页前 100 条里随便轮播：那里包含只供浏览的甜品、教程和营养异常项，
 * 也没有应用用户的忌口与菜单目标。这里复用服务端确定性整周建议，从已完成硬过滤、
 * 角色分类和营养筛选的结果中抽取同餐次、同角色且本周未使用的一道。
 */
export function useRecipeReplacement() {
  const seed = useRef(0);

  const findReplacement = useCallback(async ({
    component,
    currentId,
    meal,
    unavailableIds,
    weekStart,
  }: {
    component: RecipeComponent | undefined;
    currentId: string;
    meal: MealSlot;
    unavailableIds: string[];
    weekStart: string;
  }) => {
    if (!weekStart) return { failure: '本周日期还没加载完成，请稍后再试。' };

    try {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        seed.current += 1;
        const response = await getMealPlanSuggestion({
          week_start: weekStart,
          seed: seed.current,
        });
        const recipes = response.data.entries
          .filter((entry) => entry.meal_slot === meal && entry.component === component)
          .flatMap((entry) => (entry.recipe ? [toRecipe(entry.recipe as ApiRecipe)] : []));
        const recipe = nextSwapRecipe(
          recipes,
          currentId,
          meal,
          component,
          unavailableIds,
        );
        if (recipe) return { recipe };
      }
      return { failure: '按当前过敏原、忌口和用餐条件，暂时没有更多同类菜可换。' };
    } catch (error) {
      return { failure: errorMessage(error, '没能找到替换菜谱，请稍后再试。') };
    }
  }, []);

  return { findReplacement };
}
