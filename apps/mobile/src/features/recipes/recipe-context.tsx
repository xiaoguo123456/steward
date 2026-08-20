import { createContext, type PropsWithChildren, useContext, useMemo, useState } from 'react';

import { useDietProfile } from './use-diet-profile';
import { useMealPlan } from './use-meal-plan';
import { useRecipeContent } from './use-recipe-content';
import { useRecipeMarks } from './use-recipe-marks';
import {
  mealSlotOrder,
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
  swapRecipe: (dayId: WeekDayId, meal: MealSlot) => void;
  setRecipeForMeal: (dayId: WeekDayId, meal: MealSlot, recipeId: string) => void;
  regenerateWeek: () => void;
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

/** 在同一餐位的候选里往后挑一道，用于「换一道」。 */
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
  const content = useRecipeContent();
  const mealPlan = useMealPlan();
  const diet = useDietProfile();
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
      getRecipe: content.getRecipe,

      days: mealPlan.days,
      weekStart: mealPlan.weekStart,
      selectedDayId,
      setSelectedDayId: setPickedDayId,

      plan: mealPlan.plan,
      planLoading: mealPlan.loading,
      hasPendingPlan: mealPlan.hasPendingPlan,
      planSaving: mealPlan.saving,
      planFailure: mealPlan.failure,
      plannedNutrition: mealPlan.plannedNutrition,

      setRecipeForMeal: mealPlan.setRecipeForMeal,
      swapRecipe: (dayId, meal) => {
        const current = mealPlan.plan[dayId]?.[meal] ?? '';
        mealPlan.setRecipeForMeal(dayId, meal, nextRecipeId(content.recipes, current, meal));
      },
      regenerateWeek: () => {
        const next: WeekPlan = {};
        mealPlan.days.forEach((day, dayIndex) => {
          const currentDay = mealPlan.plan[day.id] ?? {
            breakfast: '',
            lunch: '',
            dinner: '',
          };
          const nextDay = { ...currentDay };
          mealSlotOrder.forEach((meal, mealIndex) => {
            nextDay[meal] = nextRecipeId(
              content.recipes,
              currentDay[meal],
              meal,
              dayIndex + mealIndex + 1,
            );
          });
          next[day.id] = nextDay;
        });
        mealPlan.replaceWeek(next);
      },
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
    [content, mealPlan, diet, marks, selectedDayId],
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
