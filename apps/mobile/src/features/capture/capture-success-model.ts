import type { AffectedResource } from '@steward/api-client';

const resourceLabels = {
  task: '任务',
  event: '日程',
  project: '项目',
  note: '笔记',
  tracker: '记录项',
  record: '记录',
} as const;

type SummarizedResourceType = keyof typeof resourceLabels;

export type CaptureSaveSummary = {
  count: number;
  text: string;
};

export function summarizeCaptureResources(
  resources: readonly AffectedResource[],
  fallbackCount = 0,
): CaptureSaveSummary {
  const seen = new Set<string>();
  const counts = new Map<SummarizedResourceType, number>();

  for (const resource of resources) {
    if (!resource.id || !(resource.type in resourceLabels)) continue;
    const type = resource.type as SummarizedResourceType;
    const identity = `${type}:${resource.id}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }

  const parts = Object.entries(resourceLabels)
    .map(([type, label]) => {
      const count = counts.get(type as SummarizedResourceType) ?? 0;
      return count > 0 ? `${count} 项${label}` : null;
    })
    .filter((part): part is string => Boolean(part));
  const count = [...counts.values()].reduce((total, current) => total + current, 0);

  if (parts.length > 0) {
    return { count, text: parts.join('、') };
  }

  const safeFallback = Math.max(0, Math.floor(fallbackCount));
  return {
    count: safeFallback,
    text: safeFallback > 0 ? `${safeFallback} 项内容` : '内容',
  };
}
