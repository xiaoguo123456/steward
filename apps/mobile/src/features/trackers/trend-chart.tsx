import type { Record as TrackerRecord, TrackerField } from '@steward/api-client';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, radius, typography } from '@/theme/tokens';

export type TrendRange = 'week' | 'month';

type Point = {
  timestamp: string;
  value: number;
};

const chartHeight = 126;
const horizontalPadding = 12;
const verticalPadding = 14;

/**
 * 数值型 Record 的轻量折线图。
 *
 * 不引入第二套图表依赖；同时保留最高、最低与日期文字，让趋势不只靠颜色和曲线表达。
 */
export function TrackerTrendChart({
  field,
  records,
  range,
}: {
  field: TrackerField;
  records: TrackerRecord[];
  range: TrendRange;
}) {
  const [width, setWidth] = useState(0);
  const points = useMemo(() => selectPoints(records, field, range), [field, range, records]);

  if (points.length < 2) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>再记录一次，就能看到变化</Text>
      </View>
    );
  }

  const values = points.map((point) => point.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum || 1;
  const drawWidth = Math.max(width - horizontalPadding * 2, 1);
  const drawHeight = chartHeight - verticalPadding * 2;
  const coordinates = points.map((point, index) => ({
    x: horizontalPadding + (index / (points.length - 1)) * drawWidth,
    y: verticalPadding + ((maximum - point.value) / span) * drawHeight,
  }));
  const unit = field.unit ?? '';

  return (
    <View
      accessibilityLabel={`${range === 'week' ? '近七天' : '近三十天'}趋势，最高${formatValue(maximum)}${unit}，最低${formatValue(minimum)}${unit}`}
      accessibilityRole="image"
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={styles.chart}
    >
      <View style={styles.stats}>
        <Text style={styles.stat}>最高 {formatValue(maximum)}{unit}</Text>
        <Text style={styles.stat}>最低 {formatValue(minimum)}{unit}</Text>
      </View>

      <View style={styles.plot}>
        {[0, 0.5, 1].map((position) => (
          <View
            key={position}
            style={[styles.gridLine, { top: verticalPadding + position * drawHeight }]}
          />
        ))}
        {width > 0
          ? coordinates.slice(1).map((point, index) => {
              const previous = coordinates[index];
              const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
              const angle = Math.atan2(point.y - previous.y, point.x - previous.x);
              return (
                <View
                  key={`line-${points[index + 1].timestamp}`}
                  style={[
                    styles.line,
                    {
                      left: (previous.x + point.x) / 2 - distance / 2,
                      top: (previous.y + point.y) / 2 - 1,
                      width: distance,
                      transform: [{ rotate: `${angle}rad` }],
                    },
                  ]}
                />
              );
            })
          : null}
        {width > 0
          ? coordinates.map((point, index) => (
              <View
                key={`point-${points[index].timestamp}`}
                style={[styles.point, { left: point.x - 4, top: point.y - 4 }]}
              />
            ))
          : null}
      </View>

      <View style={styles.dates}>
        <Text style={styles.date}>{formatDate(points[0].timestamp)}</Text>
        <Text style={styles.date}>{formatDate(points[points.length - 1].timestamp)}</Text>
      </View>
    </View>
  );
}

function selectPoints(
  records: TrackerRecord[],
  field: TrackerField,
  range: TrendRange,
): Point[] {
  const days = range === 'week' ? 7 : 30;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return records
    .map((record) => ({
      timestamp: record.timestamp,
      value: record.values.find((value) => value.key === field.key)?.number_value,
    }))
    .filter(
      (point): point is Point =>
        typeof point.value === 'number' && new Date(point.timestamp).getTime() >= cutoff,
    )
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatDate(timestamp: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(
    new Date(timestamp),
  );
}

const styles = StyleSheet.create({
  chart: {
    padding: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  stats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stat: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  plot: {
    height: chartHeight,
    marginTop: 4,
    overflow: 'hidden',
  },
  gridLine: {
    position: 'absolute',
    left: horizontalPadding,
    right: horizontalPadding,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  line: {
    position: 'absolute',
    height: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  point: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.background,
    backgroundColor: colors.primaryStrong,
  },
  dates: {
    marginTop: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  date: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.caption,
  },
  empty: {
    minHeight: 112,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  emptyTitle: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
  },
});
