import type { Record as TrackerRecord, TrackerField } from '@steward/api-client';

export type TrendRange = 'week' | 'month';

export type TrendPoint = {
  id: string;
  timestamp: string;
  value: number;
};

export type TrendTick = {
  position: number;
  value: number;
};

export type TrendScale = {
  maximum: number;
  minimum: number;
  positionOf: (value: number) => number;
  ticks: TrendTick[];
  zeroPosition: number;
};

/**
 * 保留既有 Record 粒度，只筛选所选时间范围内可绘制的有限数值。
 *
 * 趋势图不在客户端做按日汇总或单位换算，避免改变服务端记录语义。
 */
export function selectTrendPoints(
  records: readonly TrackerRecord[],
  field: TrackerField,
  range: TrendRange,
  now = Date.now(),
): TrendPoint[] {
  const days = range === 'week' ? 7 : 30;
  const cutoff = now - days * 24 * 60 * 60 * 1000;

  return records
    .map((record) => ({
      id: record.id,
      timestamp: record.timestamp,
      value: record.values.find((value) => value.key === field.key)?.number_value,
    }))
    .filter((point): point is TrendPoint => {
      const time = Date.parse(point.timestamp);
      return (
        typeof point.value === 'number' &&
        Number.isFinite(point.value) &&
        Number.isFinite(time) &&
        time >= cutoff
      );
    })
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

/** 为正数、负数、跨零与全零序列生成稳定的零基线和三条刻度。 */
export function createTrendScale(values: readonly number[]): TrendScale {
  const rawMinimum = Math.min(...values);
  const rawMaximum = Math.max(...values);
  const safeMinimum = Number.isFinite(rawMinimum) ? rawMinimum : 0;
  const safeMaximum = Number.isFinite(rawMaximum) ? rawMaximum : 0;

  let minimum = safeMinimum;
  let maximum = safeMaximum;

  if (minimum === 0 && maximum === 0) {
    maximum = 1;
  } else if (minimum >= 0) {
    minimum = 0;
    maximum *= 1.08;
  } else if (maximum <= 0) {
    maximum = 0;
    minimum *= 1.08;
  } else {
    const padding = (maximum - minimum) * 0.08;
    minimum -= padding;
    maximum += padding;
  }

  const span = maximum - minimum || 1;
  const positionOf = (value: number) => (maximum - value) / span;
  const zeroPosition = positionOf(0);
  const tickValues =
    safeMinimum < 0 && safeMaximum > 0
      ? [safeMaximum, 0, safeMinimum]
      : [maximum, (maximum + minimum) / 2, minimum];

  return {
    maximum: safeMaximum,
    minimum: safeMinimum,
    positionOf,
    ticks: tickValues.map((value) => ({ value, position: positionOf(value) })),
    zeroPosition,
  };
}

/** 月视图减少重复日期标签；首尾日期始终保留。 */
export function getDateLabelIndexes(points: readonly TrendPoint[], range: TrendRange): Set<number> {
  if (points.length <= 1) return new Set(points.map((_, index) => index));
  if (range === 'week') return new Set(points.map((_, index) => index));

  const indexes = new Set<number>([0, points.length - 1]);
  let lastLabelIndex = 0;
  let lastLabelDay = localDay(points[0].timestamp);

  for (let index = 1; index < points.length - 1; index += 1) {
    const day = localDay(points[index].timestamp);
    if (day !== lastLabelDay && index - lastLabelIndex >= 2) {
      indexes.add(index);
      lastLabelIndex = index;
      lastLabelDay = day;
    }
  }

  return indexes;
}

function localDay(timestamp: string): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
