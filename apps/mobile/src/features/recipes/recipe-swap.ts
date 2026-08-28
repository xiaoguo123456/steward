import type {
  MealSlot,
  Recipe,
  RecipeComponent,
  WeekDayId,
  WeekPlan,
} from './model';

/**
 * 找同餐次、同角色的下一道菜。
 *
 * 「换一道」不能只看 breakfast / lunch / dinner：把早餐的主食换成荤菜，
 * 虽然餐次没错，整餐结构仍然会坏掉。同一餐已经出现的菜也不能再选一次。
 */
export function nextSwapRecipe(
  recipes: Recipe[],
  currentId: string,
  meal: MealSlot,
  component: RecipeComponent | undefined,
  unavailableIds: Iterable<string> = [],
): Recipe | undefined {
  const currentRecipe = recipes.find((recipe) => recipe.id === currentId);
  const targetComponent = component ?? currentRecipe?.component;
  const unavailable = new Set(unavailableIds);
  const candidates = recipes.filter(
    (recipe) =>
      recipe.mealSlots.includes(meal)
      && (!targetComponent || recipe.component === targetComponent)
      && (!unavailable.has(recipe.id) || recipe.id === currentId),
  );

  if (candidates.length === 0) return undefined;
  const currentIndex = candidates.findIndex((recipe) => recipe.id === currentId);
  const start = currentIndex >= 0 ? currentIndex : -1;
  for (let offset = 1; offset <= candidates.length; offset += 1) {
    const candidate = candidates[(start + offset) % candidates.length];
    if (candidate && candidate.id !== currentId) return candidate;
  }
  return undefined;
}

/** 返回替换后的新菜单，不修改原对象。 */
export function replaceDishInPlan(
  plan: WeekPlan,
  dayId: WeekDayId,
  meal: MealSlot,
  index: number,
  recipeId: string,
  component?: RecipeComponent,
): WeekPlan {
  const day = plan[dayId];
  const dishes = [...(day?.[meal] ?? [])];
  if (!day || index < 0 || index >= dishes.length) return plan;
  dishes[index] = { ...dishes[index], recipeId, component: component ?? dishes[index]?.component };
  return { ...plan, [dayId]: { ...day, [meal]: dishes } };
}
