export type ReviewPeriod = {
  weekOf: string;
  label: string;
};

/**
 * 返回最近完成的自然周，周一为一周起点。
 * 当前周尚未结束，因此不会出现在默认复盘周期中。
 */
export function recentCompletedPeriods(
  count = 8,
  today = new Date(),
): ReviewPeriod[] {
  const periodCount = Math.max(0, Math.floor(count));
  const currentWeekStart = startOfLocalWeek(today);

  return Array.from({ length: periodCount }, (_, index) => {
    const weekStart = new Date(currentWeekStart);
    weekStart.setDate(weekStart.getDate() - (index + 1) * 7);

    return {
      weekOf: toDateParam(weekStart),
      label: index === 0 ? '上周' : `${index + 1} 周前`,
    };
  });
}

function startOfLocalWeek(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const daysSinceMonday = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - daysSinceMonday);
  return result;
}

function toDateParam(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
