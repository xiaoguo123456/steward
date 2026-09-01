export type ImportantDateTiming = {
  daysUntil: number;
};

export type ImportantDateGroups<T extends ImportantDateTiming> = {
  nextItem: T | undefined;
  laterItems: T[];
  expiredItems: T[];
};

/**
 * 把服务端排好序的重要日分成即将到来、后续和已过期三组。
 *
 * 分组会保留每组在响应中的顺序，不在客户端重新计算日期或排序。
 * 这也让新客户端在短暂连到旧服务端时，不会把负数天数放进
 * “即将到来”主卡片。
 */
export function groupImportantDates<T extends ImportantDateTiming>(
  items: readonly T[],
): ImportantDateGroups<T> {
  const upcomingItems: T[] = [];
  const expiredItems: T[] = [];

  for (const item of items) {
    if (item.daysUntil < 0) expiredItems.push(item);
    else upcomingItems.push(item);
  }

  return {
    nextItem: upcomingItems[0],
    laterItems: upcomingItems.slice(1),
    expiredItems,
  };
}
