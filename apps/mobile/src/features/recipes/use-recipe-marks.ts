import {
  errorMessage,
  favoriteRecipe,
  markRecipeCooked,
  unfavoriteRecipe,
  useListFavoriteRecipes,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

/**
 * 收藏与「做过」。
 *
 * 「做过」只记这件事本身，不等于记录了实际摄入——后者是 Record，
 * 走记录项接口，由用户单独确认。
 */
export function useRecipeMarks() {
  const queryClient = useQueryClient();
  const favorites = useListFavoriteRecipes({ limit: 100 });
  const [failure, setFailure] = useState<string | null>(null);
  // 本次会话里标过「做过」的菜。它是一条日志，服务端没有「做过没有」这个状态，
  // 所以这里只用于给刚点过的那道菜一个即时反馈。
  const [cookedIds, setCookedIds] = useState<Set<string>>(new Set());

  const favoriteIds = useMemo(
    () => new Set((favorites.data?.data ?? []).map((recipe) => recipe.id)),
    [favorites.data],
  );

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setFailure(null);
    try {
      await action();
      await queryClient.invalidateQueries();
    } catch (error) {
      setFailure(errorMessage(error, fallback));
    }
  };

  return {
    favoriteIds,
    favorites: favorites.data?.data ?? [],
    loading: favorites.isPending,
    failure,
    cookedIds,

    toggleFavorite: (recipeId: string) => {
      const remove = favoriteIds.has(recipeId);
      void run(
        () => (remove ? unfavoriteRecipe(recipeId) : favoriteRecipe(recipeId)),
        remove ? '取消收藏没能保存。' : '收藏没能保存。',
      );
    },

    markCooked: (recipeId: string) => {
      setCookedIds((current) => new Set(current).add(recipeId));
      void run(() => markRecipeCooked(recipeId), '没能记下这次。');
    },
  };
}
