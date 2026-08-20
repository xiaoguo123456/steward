import { useListRecipes, type Recipe as ApiRecipe } from '@steward/api-client';
import { useMemo } from 'react';

import type {
  MealSlot,
  Recipe,
  RecipeCategory,
  RecipeDifficulty,
  RecipeGoal,
  RecipeIngredient,
  RecipeStep,
} from './model';

/**
 * 菜谱内容。
 *
 * 菜谱是平台提供的只读内容，不是用户数据：所有人看到同一份，
 * 因此这里只读不写。用户自己的东西是本周菜单和实际摄入，那些走别的接口。
 *
 * 当前库里是几条占位内容。正式菜谱接入前必须先确定来源、作者、
 * 图片权利与授权范围——契约里的 source 字段就是为此存在的。
 */
export function useRecipeContent() {
  const query = useListRecipes({ limit: 100 });

  const recipes = useMemo(
    () => (query.data?.data ?? []).map(toRecipe),
    [query.data],
  );

  const byId = useMemo(
    () => new Map(recipes.map((recipe) => [recipe.id, recipe])),
    [recipes],
  );

  return {
    recipes,
    loading: query.isLoading,
    getRecipe: (recipeId: string) => byId.get(recipeId),
  };
}

const difficultyLabels: Record<string, RecipeDifficulty> = {
  easy: '容易',
  medium: '适中',
  hard: '适中',
};

/** 契约枚举用下划线，展示模型沿用原来的连字符写法。 */
function toLocalKey(value: string) {
  return value.replace(/_/g, '-');
}

function toRecipe(recipe: ApiRecipe): Recipe {
  return {
    id: recipe.id,
    title: recipe.title,
    // 没有明确图片权利的菜谱不带图，客户端展示占位。
    image: recipe.image_url ?? '',
    imageDescription: recipe.title,
    imageCredit: recipe.source.image_credit ?? '',
    timeMinutes: recipe.duration_minutes,
    difficulty: difficultyLabels[recipe.difficulty] ?? '适中',
    servings: recipe.servings,
    calories: recipe.nutrition.calories,
    protein: recipe.nutrition.protein_g,
    carbs: recipe.nutrition.carbs_g,
    fat: recipe.nutrition.fat_g ?? undefined,
    fiber: recipe.nutrition.fiber_g ?? undefined,
    recommendation: recipe.summary ?? '',
    description: recipe.summary ?? '',
    mealSlots: recipe.meal_slots as MealSlot[],
    categories: recipe.categories.map(toLocalKey) as RecipeCategory[],
    goals: recipe.goals.map(toLocalKey) as RecipeGoal[],
    tags: recipe.tags,
    allergens: recipe.allergens,
    ingredients: recipe.ingredients.map(toIngredient),
    steps: recipe.steps.map(toStep),
    sourceLabel: sourceLabelOf(recipe),
  };
}

/** 来源标签要能让用户看出这条内容从哪来、按什么授权展示。 */
function sourceLabelOf(recipe: ApiRecipe): string {
  const parts = [recipe.source.name];
  if (recipe.source.author) parts.push(recipe.source.author);
  parts.push(recipe.source.license);
  return parts.join(' · ');
}

function toIngredient(item: ApiRecipe['ingredients'][number], index: number): RecipeIngredient {
  return {
    id: `${item.name}-${index}`,
    name: item.name,
    amount: item.amount,
    group: item.group,
  };
}

function toStep(item: ApiRecipe['steps'][number]): RecipeStep {
  return {
    title: item.title,
    description: item.description,
    timerMinutes: item.timer_minutes ?? undefined,
  };
}
