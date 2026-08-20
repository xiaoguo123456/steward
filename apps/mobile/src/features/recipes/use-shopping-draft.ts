import {
  createShoppingListFromMealPlan,
  errorMessage,
  useGetMealPlanShoppingDraft,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import type { IngredientGroup } from './model';

/** 待采购的一项。合并与分组都由服务端做完了。 */
export type ShoppingDraftItem = {
  /** 名称同时也是标识：服务端已按名称合并过。 */
  id: string;
  name: string;
  group: IngredientGroup;
  amount: string;
  recipeIds: string[];
};

/**
 * 购物清单草稿。
 *
 * 合并重复食材、换算份量、按品类分组全部在服务端（规格 8.2.2）：
 * 客户端自己再合并一遍，迟早会和真正创建出来的清单对不上。
 *
 * 创建出来的是正式的 TaskList + Task，不是食谱模块私有的什么东西。
 */
export function useShoppingDraft(options: { weekStart?: string; date?: string }) {
  const queryClient = useQueryClient();
  const query = useGetMealPlanShoppingDraft(
    {
      ...(options.weekStart ? { week_start: options.weekStart } : {}),
      ...(options.date ? { date: options.date } : {}),
    },
    { query: { enabled: Boolean(options.weekStart) } },
  );

  const [creating, setCreating] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const items = useMemo<ShoppingDraftItem[]>(
    () =>
      (query.data?.data.items ?? []).map((item) => ({
        id: item.name,
        name: item.name,
        group: item.group as IngredientGroup,
        amount: item.quantity_text || '适量',
        recipeIds: item.recipe_ids,
      })),
    [query.data],
  );

  /** 用选中的食材创建清单。excluded 是用户勾掉的「家里已有」。 */
  const create = async (excluded: Set<string>) => {
    const selected = items.filter((item) => !excluded.has(item.id));
    if (selected.length === 0 || !options.weekStart) return false;

    setCreating(true);
    setFailure(null);
    try {
      await createShoppingListFromMealPlan({
        week_start: options.weekStart,
        items: selected.map((item) => ({
          name: item.name,
          quantity_text: item.amount,
          recipe_ids: item.recipeIds,
        })),
      });
      // 新清单会出现在计划页，缓存要跟着失效。
      await queryClient.invalidateQueries();
      return true;
    } catch (error) {
      setFailure(errorMessage(error, '购物清单没能创建。'));
      return false;
    } finally {
      setCreating(false);
    }
  };

  return {
    items,
    loading: query.isPending,
    failed: query.isError,
    error: query.error,
    creating,
    failure,
    create,
  };
}
