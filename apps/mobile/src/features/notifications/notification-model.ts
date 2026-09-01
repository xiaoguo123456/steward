import type { Notification, NotificationSourceType } from '@steward/api-client';

export type NotificationGroup = {
  key: 'today' | 'earlier';
  title: '今天' | '更早';
  items: Notification[];
};

export type NotificationDestination = {
  pathname: '/tasks/[id]' | '/events/[id]' | '/projects/[id]' | '/features/[slug]';
  params: { id: string } | { slug: 'review' };
};

/** 通知来源到正式详情路由的唯一映射。 */
export function notificationDestination(
  sourceType: NotificationSourceType,
  sourceId: string,
): NotificationDestination {
  switch (sourceType) {
    case 'task':
      return { pathname: '/tasks/[id]', params: { id: sourceId } };
    case 'event':
      return { pathname: '/events/[id]', params: { id: sourceId } };
    case 'project':
      return { pathname: '/projects/[id]', params: { id: sourceId } };
    case 'review':
      return { pathname: '/features/[slug]', params: { slug: 'review' } };
  }
}

/** 分组只使用本地自然日；不改变服务端发生时间与排序。 */
export function groupNotifications(
  items: readonly Notification[],
  now = new Date(),
): NotificationGroup[] {
  const today: Notification[] = [];
  const earlier: Notification[] = [];

  for (const item of items) {
    const occurredAt = new Date(item.occurred_at);
    if (!Number.isNaN(occurredAt.getTime()) && isSameLocalDay(occurredAt, now)) {
      today.push(item);
    } else {
      earlier.push(item);
    }
  }

  const groups: NotificationGroup[] = [];
  if (today.length > 0) groups.push({ key: 'today', title: '今天', items: today });
  if (earlier.length > 0) groups.push({ key: 'earlier', title: '更早', items: earlier });
  return groups;
}

/** 游标翻页可能与刷新交错，按 id 去重并以新响应覆盖旧快照。 */
export function mergeNotifications(
  current: readonly Notification[],
  incoming: readonly Notification[],
): Notification[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()].sort(
    (left, right) =>
      new Date(right.occurred_at).getTime() - new Date(left.occurred_at).getTime(),
  );
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}
