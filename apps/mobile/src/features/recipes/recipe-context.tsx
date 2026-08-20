import { createContext, type PropsWithChildren, useContext, useMemo, useState } from 'react';

import { useDietProfile } from './use-diet-profile';
import { useMealPlan } from './use-meal-plan';
import { useMealPlanSuggestion } from './use-meal-plan-suggestion';
import { useRecipeContent } from './use-recipe-content';
import { useRecipeMarks } from './use-recipe-marks';
import type { MealPlanSuggestionNote } from '@steward/api-client';

import {
  type MealSlot,
  type Recipe,
  type RecipeNutrition,
  type RecipeProfile,
  type WeekDay,
  type WeekDayId,
  type WeekPlan,
} from './model';

/**
 * 食谱场景的共享状态。
 *
 * 菜谱内容是平台的只读内容；本周菜单、收藏与饮食档案都是用户自己的数据，
 * 各自走契约接口并受行级安全约束。
 *
 * 只有一样东西留在本地：**还没点「采用」的菜单草稿**。
 * 规格 8.2.2 要求 AI 预览必须先经用户确认才能保存，所以草稿不落库——
 * 用户改到一半退出去，下次看到的仍是他上次确认过的那份。
 */
type RecipeContextValue = {
  recipes: Recipe[];
  recipesLoading: boolean;
  getRecipe: (recipeId: string) => Recipe | undefined;

  /** 本周七天，由服务端给出的周起始日推出。 */
  days: WeekDay[];
  weekStart: string;
  selectedDayId: WeekDayId;
  setSelectedDayId: (dayId: WeekDayId) => void;

  plan: WeekPlan;
  planLoading: boolean;
  hasPendingPlan: boolean;
  planSaving: boolean;
  planFailure: string | null;
  /** 已确认菜单的整周计划摄入，由服务端求和。 */
  plannedNutrition?: RecipeNutrition;
  /** 把一格里第 index 道换成同类的另一道。 */
  swapRecipe: (dayId: WeekDayId, meal: MealSlot, index: number) => void;
  /** 把一道菜加进某一餐（菜谱详情页用）。 */
  addRecipeToMeal: (dayId: WeekDayId, meal: MealSlot, recipeId: string) => void;
  /** 首次生成本周菜单。 */
  generateWeek: () => Promise<void>;
  /** 换一批：同一份档案下换另一组菜。 */
  regenerateWeek: () => Promise<void>;
  /** 正在向服务端要一份菜单。 */
  planGenerating: boolean;
  /** 本次生成做了什么妥协（过敏原筛太狠、时间放宽了等）。空数组表示没有。 */
  planNotes: MealPlanSuggestionNote[];
  /**
   * 按身高、体重、年龄与目标算出的每日热量目标。
   *
   * 身体数据没填全时为 null——此时不显示目标，也不显示一个编出来的数字。
   */
  dailyTarget: { calories: number; proteinG: number } | null;
  confirmPlan: () => Promise<boolean>;
  discardPlan: () => void;

  profile: RecipeProfile | null;
  profileCompleted: boolean;
  profileSaving: boolean;
  profileFailure: string | null;
  saveProfile: (profile: RecipeProfile) => Promise<boolean>;

  favoriteIds: Set<string>;
  toggleFavorite: (recipeId: string) => void;
  cookedIds: Set<string>;
  markCooked: (recipeId: string) => void;
};

const RecipeContext = createContext<RecipeContextValue | null>(null);

/**
 * 在同一餐位的候选里往后挑一道，用于单格的「换一道」。
 *
 * 只在**已经取回来的**菜谱里换，是刻意的：换一道要立刻有反应，
 * 为一道菜去服务端跑一次整周生成不值得。整周「换一批」走服务端，
 * 因为那时过敏原过滤与热量目标都要看全库。
 *
 * 浏览列表本身已经按用户的过敏原过滤过，所以换出来的不会有过敏原。
 */
function nextRecipeId(recipes: Recipe[], currentId: string, meal: MealSlot, offset = 1) {
  const candidates = recipes.filter((recipe) => recipe.mealSlots.includes(meal));
  if (candidates.length === 0) return currentId;
  const currentIndex = Math.max(
    0,
    candidates.findIndex((recipe) => recipe.id === currentId),
  );
  return candidates[(currentIndex + offset) % candidates.length]?.id ?? currentId;
}

export function RecipePrototypeProvider({ children }: PropsWithChildren) {
  // 先读档案：浏览列表要按用户的过敏原过滤，不传就等于没填。
  const diet = useDietProfile();
  const content = useRecipeContent(diet.profile?.allergies ?? []);
  const mealPlan = useMealPlan();
  const suggestion = useMealPlanSuggestion();
  const marks = useRecipeMarks();

  const [pickedDayId, setPickedDayId] = useState<WeekDayId | null>(null);

  // 默认选中今天。用户点过某天之后以他选的为准，
  // 但那天不在当前这一周时（比如跨周了）回到今天。
  const fallbackDayId =
    mealPlan.days.find((day) => day.isToday)?.id ?? mealPlan.days[0]?.id ?? '';
  const selectedDayId =
    pickedDayId && mealPlan.days.some((day) => day.id === pickedDayId)
      ? pickedDayId
      : fallbackDayId;

  const value = useMemo<RecipeContextValue>(
    () => ({
      recipes: content.recipes,
      recipesLoading: content.loading,
      // 菜单里的菜谱不一定在浏览列表的前 100 条里，
      // 已确认菜单与建议各自带回了自己的那些，合起来查。
      getRecipe: (recipeId: string) =>
        content.getRecipe(recipeId) ??
        suggestion.recipes.get(recipeId) ??
        mealPlan.recipes.get(recipeId),

      days: mealPlan.days,
      weekStart: mealPlan.weekStart,
      selectedDayId,
      setSelectedDayId: setPickedDayId,

      plan: mealPlan.plan,
      planLoading: mealPlan.loading,
      hasPendingPlan: mealPlan.hasPendingPlan,
      planSaving: mealPlan.saving,
      planFailure: mealPlan.failure ?? suggestion.failure,
      plannedNutrition: mealPlan.plannedNutrition,

      addRecipeToMeal: (dayId, meal, recipeId) => {
        const recipe = content.getRecipe(recipeId);
        mealPlan.addDish(dayId, meal, { recipeId, component: recipe?.component });
      },
      swapRecipe: (dayId, meal, index) => {
        const current = mealPlan.plan[dayId]?.[meal]?.[index]?.recipeId ?? '';
        mealPlan.replaceDish(
          dayId,
          meal,
          index,
          nextRecipeId(content.recipes, current, meal),
        );
      },
      // 整周生成走服务端。
      //
      // 客户端手里只有前 100 条菜谱，在那里面轮播既筛不掉过敏原，
      // 也谈不上按目标选菜——之前就是这么做的，等于问卷白填了。
      generateWeek: async () => {
        const next = await suggestion.generate(mealPlan.weekStart);
        if (next) mealPlan.replaceWeek(next);
      },
      regenerateWeek: async () => {
        const next = await suggestion.regenerate(mealPlan.weekStart);
        if (next) mealPlan.replaceWeek(next);
      },
      planGenerating: suggestion.loading,
      planNotes: suggestion.notes,
      dailyTarget: suggestion.dailyTarget,
      confirmPlan: mealPlan.confirm,
      discardPlan: mealPlan.discard,

      profile: diet.profile,
      profileCompleted: diet.completed,
      profileSaving: diet.saving,
      profileFailure: diet.failure,
      saveProfile: diet.save,

      favoriteIds: marks.favoriteIds,
      toggleFavorite: marks.toggleFavorite,
      cookedIds: marks.cookedIds,
      markCooked: marks.markCooked,
    }),
    [content, mealPlan, suggestion, diet, marks, selectedDayId],
  );

  return <RecipeContext.Provider value={value}>{children}</RecipeContext.Provider>;
}

export function useRecipePrototype() {
  const value = useContext(RecipeContext);
  if (!value) {
    throw new Error('useRecipePrototype 必须在 RecipePrototypeProvider 中使用');
  }
  return value;
}
