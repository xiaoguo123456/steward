import {
  errorMessage,
  getMealPlanSuggestion,
  type MealPlanSuggestionNote,
  type Recipe as ApiRecipe,
} from '@steward/api-client';
import { useState } from 'react';

import { toRecipe } from './use-recipe-content';
import type { MealSlot, Recipe, WeekPlan } from './model';

/**
 * 一周菜单建议。
 *
 * 选菜在服务端：过敏原与忌口是硬过滤，只有服务端手里有完整的菜谱库
 * （客户端列表只取前 100 条，用它来选菜等于在一个随机子集里挑）。
 * 目标匹配同理——它要看全库的营养分布才排得出名次。
 *
 * 拿回来的只是**草稿**，写进本地菜单等用户点「采用本周菜单」才落库。
 *
 * seed 由客户端递增：同一个 seed 服务端必然给出同一份菜单，
 * 所以「换一批」是 seed + 1，而不是重新掷一次骰子。
 */
export function useMealPlanSuggestion() {
  const [seed, setSeed] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [notes, setNotes] = useState<MealPlanSuggestionNote[]>([]);
  // 建议里的菜谱多半不在浏览列表的那 100 条里，
  // 不把它们留下来，菜单格子就会渲染成空白。
  const [recipes, setRecipes] = useState<Map<string, Recipe>>(new Map());

  const generate = async (weekStart: string, nextSeed: number): Promise<WeekPlan | null> => {
    if (!weekStart) return null;
    setLoading(true);
    setFailure(null);
    try {
      const response = await getMealPlanSuggestion({ week_start: weekStart, seed: nextSeed });
      const data = response.data;

      const found = new Map<string, Recipe>();
      const plan: WeekPlan = {};
      for (const entry of data.entries) {
        const day = plan[entry.date] ?? { breakfast: '', lunch: '', dinner: '' };
        day[entry.meal_slot as MealSlot] = entry.recipe_id;
        plan[entry.date] = day;
        if (entry.recipe) found.set(entry.recipe_id, toRecipe(entry.recipe as ApiRecipe));
      }

      setSeed(data.seed);
      setNotes(data.notes);
      setRecipes((current) => new Map([...current, ...found]));
      return plan;
    } catch (error) {
      setFailure(errorMessage(error, '没能生成菜单，稍后再试。'));
      return null;
    } finally {
      setLoading(false);
    }
  };

  return {
    seed,
    loading,
    failure,
    /** 本次生成做了什么妥协。空数组表示没有妥协。 */
    notes,
    /** 建议里出现过的菜谱，供菜单格子查名字与营养。 */
    recipes,
    /** 首次生成。 */
    generate: (weekStart: string) => generate(weekStart, seed),
    /** 换一批：递增 seed，服务端据此给出另一份但同样可复现的菜单。 */
    regenerate: (weekStart: string) => generate(weekStart, seed + 1),
    dismissNotes: () => setNotes([]),
  };
}
