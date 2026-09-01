import {
  errorMessage,
  useListNotifications,
  useMarkNotificationRead,
  type Notification,
} from '@steward/api-client';
import { useCallback, useMemo, useState } from 'react';

import { mergeNotifications } from './notification-model';

const pageSize = 20;

/** 通知中心的数据层。分页结果保留在页面会话中，服务端实体不进入全局 Store。 */
export function useNotifications() {
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadedPages, setLoadedPages] = useState<Notification[]>([]);
  const [readOverrides, setReadOverrides] = useState<Record<string, string>>({});
  const [markFailure, setMarkFailure] = useState<string | null>(null);
  const query = useListNotifications({ cursor: cursor ?? undefined, limit: pageSize });
  const refetch = query.refetch;
  const items = useMemo(
    () =>
      mergeNotifications(loadedPages, query.data?.data ?? []).map((item) =>
        readOverrides[item.id] ? { ...item, read_at: readOverrides[item.id] } : item,
      ),
    [loadedPages, query.data?.data, readOverrides],
  );

  const markRead = useMarkNotificationRead({
    mutation: {
      onMutate: ({ notificationId }) => {
        setMarkFailure(null);
        setReadOverrides((current) => ({
          ...current,
          [notificationId]: new Date().toISOString(),
        }));
      },
      onSuccess: (response) => {
        if (!response.data.read_at) return;
        setReadOverrides((current) => ({ ...current, [response.data.id]: response.data.read_at! }));
      },
      onError: (error, variables) => {
        setReadOverrides((current) => {
          const next = { ...current };
          delete next[variables.notificationId];
          return next;
        });
        setMarkFailure(errorMessage(error, '未能同步已读状态，请稍后重试。'));
      },
    },
  });

  const refresh = useCallback(async () => {
    setCursor(null);
    setLoadedPages([]);
    setMarkFailure(null);
    await refetch();
  }, [refetch]);

  const loadMore = () => {
    const nextCursor = query.data?.page.next_cursor;
    if (query.data?.page.has_more && nextCursor && !query.isFetching) {
      setLoadedPages((current) => mergeNotifications(current, query.data?.data ?? []));
      setCursor(nextCursor);
    }
  };

  return {
    items,
    initialLoading: query.isPending && items.length === 0,
    refreshing: query.isRefetching && cursor === null,
    pageLoading: query.isFetching && cursor !== null,
    initialFailure:
      query.isError && items.length === 0
        ? errorMessage(query.error, '暂时无法加载通知。')
        : null,
    pageFailure:
      query.isError && items.length > 0
        ? errorMessage(query.error, '更多通知加载失败。')
        : markFailure,
    hasMore: Boolean(query.data?.page.has_more && query.data.page.next_cursor),
    markRead: (notification: Notification) => {
      if (notification.read_at === null) {
        markRead.mutate({ notificationId: notification.id });
      }
    },
    refresh,
    loadMore,
  };
}
