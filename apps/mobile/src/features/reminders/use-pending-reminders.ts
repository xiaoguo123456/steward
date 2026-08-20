import {
  dismissReminder,
  errorMessage,
  useListPendingReminders,
  type PendingReminder,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

/**
 * 此刻该提醒用户的事。
 *
 * 判定全在服务端：哪条到点了、事件过去多久算太久、重要日今年那次是哪天，
 * 都取决于用户时区和年度投影，客户端算不准也不该算。
 */
export function usePendingReminders() {
  const queryClient = useQueryClient();
  const query = useListPendingReminders();
  const [failure, setFailure] = useState<string | null>(null);
  // 刚点掉的那条立刻从界面消失，不等请求回来——
  // 点了没反应会让人以为没点上，然后再点一次。
  const [dismissing, setDismissing] = useState<Set<string>>(new Set());

  const items = (query.data?.data ?? []).filter((item) => !dismissing.has(item.id));

  const dismiss = async (id: string) => {
    setDismissing((current) => new Set(current).add(id));
    setFailure(null);
    try {
      await dismissReminder({ id });
      await queryClient.invalidateQueries();
    } catch (error) {
      setFailure(errorMessage(error, '没能消掉这条提醒。'));
      // 失败就放回来：界面上少一条而服务端还留着，下次刷新它会突然回来。
      setDismissing((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };

  return {
    items,
    loading: query.isPending,
    failure,
    dismiss,
  };
}

/**
 * 一条提醒的说明文字。
 *
 * 说的是**事件本身**什么时候，不是提醒什么时候响的——
 * 用户关心的是「妈妈生日还有 3 天」，不是「这条提醒 4 天前触发过」。
 */
export function describeReminder(item: PendingReminder, today: Date): string {
  const days = daysUntil(item.occurrence_date, today);
  if (days > 1) return `还有 ${days} 天`;
  if (days === 1) return '就在明天';
  if (days === 0) return '就是今天';
  if (days === -1) return '昨天';
  return `已经过去 ${-days} 天`;
}

function daysUntil(isoDate: string, today: Date): number {
  const target = new Date(`${isoDate}T00:00:00`);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}
