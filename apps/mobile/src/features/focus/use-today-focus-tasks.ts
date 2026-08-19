import { useGetToday } from '@steward/api-client';
import { useMemo } from 'react';

import { colors } from '@/theme/tokens';

import type { FocusTaskReference } from './model';

/**
 * 专注可以关联的今日任务。
 *
 * 收录与排序由服务端的 Today 决定，这里不重排也不过滤——
 * 用户在专注页看到的顺序应当和首页一致。
 */
export function useTodayFocusTasks(): FocusTaskReference[] {
  const today = useGetToday();

  return useMemo(
    () =>
      (today.data?.data.tasks ?? [])
        .filter((entry) => entry.task.status !== 'done')
        .map((entry) => ({
          id: entry.task.id,
          title: entry.task.title,
          list: entry.list_name ?? '',
          // Today 已经带上了清单颜色，专注页不用再查一次。
          color: entry.list_color ?? colors.borderStrong,
        })),
    [today.data],
  );
}
