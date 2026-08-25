import type { ReviewMetric } from '@steward/api-client';

const PRIMARY_METRIC_GROUPS = [
  ['tasks_completed', 'tasks_created', 'tasks_overdue'],
  ['notes_created', 'records_logged'],
] as const;

const FALLBACK_GROUP_SIZE = 3;

/**
 * 将固定口径的复盘指标排成稳定的 3 + 2 两行。
 *
 * 服务端顺序变化时，任务、笔记与打卡仍保持一致的视觉位置；后续新增的
 * 未知指标不会丢失，而是按每行最多三项继续排列。
 */
export function groupReviewMetrics(metrics: readonly ReviewMetric[]): ReviewMetric[][] {
  const primaryKeys = new Set<string>(PRIMARY_METRIC_GROUPS.flat());
  const groups = PRIMARY_METRIC_GROUPS.map((keys) =>
    keys.flatMap((key) => metrics.filter((metric) => metric.key === key)),
  ).filter((group) => group.length > 0);
  const remaining = metrics.filter((metric) => !primaryKeys.has(metric.key));

  for (let index = 0; index < remaining.length; index += FALLBACK_GROUP_SIZE) {
    groups.push(remaining.slice(index, index + FALLBACK_GROUP_SIZE));
  }

  return groups;
}
