import {
  errorMessage,
  useListRecipes,
  type RecipeCategory as ApiRecipeCategory,
} from '@steward/api-client';
import { useEffect, useMemo, useState } from 'react';

import type { RecipeCategory } from './model';
import { toRecipe } from './use-recipe-content';

function toApiCategory(category: RecipeCategory): ApiRecipeCategory {
  return category.replace(/-/g, '_') as ApiRecipeCategory;
}

function useDebouncedValue(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [delay, value]);

  return debounced;
}

/**
 * 发现页必须按当前分类向服务端查询。
 *
 * 不能先取全库前 100 条再在手机里筛选：某个分类即使有数据，只要没有落进
 * 那 100 条，界面就会错误地显示为空。关键词也一并交给数据库匹配菜名与食材。
 */
export function useRecipeDiscovery(
  category: RecipeCategory,
  search: string,
  allergens: string[] = [],
) {
  const normalizedSearch = search.trim();
  const debouncedSearch = useDebouncedValue(normalizedSearch, 250);
  const query = useListRecipes({
    category: toApiCategory(category),
    limit: 100,
    ...(debouncedSearch ? { q: debouncedSearch } : {}),
    ...(allergens.length > 0 ? { exclude_allergens: allergens } : {}),
  });
  const recipes = useMemo(
    () => (query.data?.data ?? []).map(toRecipe),
    [query.data],
  );

  return {
    recipes,
    loading: query.isLoading || normalizedSearch !== debouncedSearch,
    loadFailure: query.isError ? errorMessage(query.error, '菜谱没能加载。') : null,
    refetch: async () => {
      await query.refetch();
    },
  };
}
