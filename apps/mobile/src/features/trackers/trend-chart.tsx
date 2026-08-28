import type { Record as TrackerRecord, TrackerField } from '@steward/api-client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, radius, typography } from '@/theme/tokens';
import {
  createTrendScale,
  getDateLabelIndexes,
  selectTrendPoints,
  type TrendRange,
} from './trend-chart-model';

export type { TrendRange } from './trend-chart-model';

const plotHeight = 142;
const dateAreaHeight = 28;
const axisWidth = 42;
const minimumHitWidth = 44;
const minimumBarHeight = 3;

/**
 * 数值型 Record 的可交互柱状图。
 *
 * 每根柱保留至少 44pt 的触摸命中区；横向空间不足时滚动查看，不把柱子压缩成难以点选的细线。
 * 图表同时显示日期和值，并由下方 Record 列表提供完整文本替代。
 */
export function TrackerTrendChart({
  field,
  records,
  range,
  failed = false,
  loading = false,
}: {
  field: TrackerField;
  records: TrackerRecord[];
  range: TrendRange;
  failed?: boolean;
  loading?: boolean;
}) {
  const [width, setWidth] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const hasPositionedScroll = useRef(false);
  const points = useMemo(
    () => selectTrendPoints(records, field, range),
    [field, range, records],
  );

  useEffect(() => {
    hasPositionedScroll.current = false;
    scrollRef.current?.scrollToEnd({ animated: false });
  }, [points]);

  if (loading && points.length === 0) {
    return (
      <View accessibilityLabel="趋势正在加载" style={styles.placeholder}>
        <View style={styles.placeholderText} />
        <View style={styles.placeholderPlot} />
      </View>
    );
  }

  if (failed && points.length === 0) {
    return <ChartMessage message="趋势暂时无法加载，可在下方重试记录。" />;
  }

  if (points.length < 2) {
    return (
      <ChartMessage
        message={points.length === 0 ? '还没有可绘制的数值记录' : '再记录一次，就能看到变化'}
      />
    );
  }

  const values = points.map((point) => point.value);
  const scale = createTrendScale(values);
  const availablePlotWidth = Math.max(width - axisWidth, 1);
  const slotWidth = Math.max(minimumHitWidth, availablePlotWidth / points.length);
  const contentWidth = slotWidth * points.length;
  const barWidth = Math.min(18, Math.max(10, slotWidth * 0.34));
  const unit = field.unit ?? '';
  const latest = points.at(-1)!;
  const peak = points.reduce((current, point) =>
    point.value > current.value ? point : current,
  );
  const selected = points.find((point) => point.id === selectedId) ?? latest;
  const dateLabelIndexes = getDateLabelIndexes(points, range);

  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={styles.chart}
    >
      <View style={styles.header}>
        <View style={styles.selectedSummary}>
          <Text style={styles.selectedDate}>{formatFullDate(selected.timestamp)}</Text>
          <View style={styles.selectedValueRow}>
            <Text style={styles.selectedValue}>
              {formatValue(selected.value)}
              {unit}
            </Text>
            {selected.id === peak.id ? <Text style={styles.badge}>峰值</Text> : null}
            {selected.id === latest.id ? <Text style={styles.badge}>最近</Text> : null}
          </View>
        </View>
        <View style={styles.stats}>
          <Text style={styles.stat}>
            最高 {formatValue(scale.maximum)}
            {unit}
          </Text>
          <Text style={styles.stat}>
            最低 {formatValue(scale.minimum)}
            {unit}
          </Text>
        </View>
      </View>

      {failed ? (
        <Text accessibilityRole="alert" style={styles.cacheNotice}>
          当前显示已加载的记录，内容可能不是最新。
        </Text>
      ) : null}

      <View style={styles.plotRow}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.axis}
        >
          {scale.ticks.map((tick) => (
            <Text
              key={`${tick.value}-${tick.position}`}
              numberOfLines={1}
              style={[styles.axisLabel, { top: tick.position * plotHeight - 7 }]}
            >
              {formatAxisValue(tick.value)}
            </Text>
          ))}
        </View>

        <ScrollView
          accessibilityLabel={`${range === 'week' ? '近七天' : '近三十天'}柱状趋势，可横向滚动并点选每条记录`}
          contentContainerStyle={{ width: contentWidth }}
          horizontal
          onContentSizeChange={() => {
            if (!hasPositionedScroll.current) {
              hasPositionedScroll.current = true;
              scrollRef.current?.scrollToEnd({ animated: false });
            }
          }}
          ref={scrollRef}
          showsHorizontalScrollIndicator={false}
          style={styles.plotScroller}
        >
          <View style={[styles.plot, { width: contentWidth }]}>
            {scale.ticks.map((tick) => (
              <View
                key={`grid-${tick.value}-${tick.position}`}
                style={[styles.gridLine, { top: tick.position * plotHeight }]}
              />
            ))}
            <View style={[styles.zeroLine, { top: scale.zeroPosition * plotHeight }]} />

            {points.map((point, index) => {
              const valuePosition = scale.positionOf(point.value);
              const zeroPosition = scale.zeroPosition;
              const isZero = Math.abs(point.value) < 0.000001;
              const top = Math.min(valuePosition, zeroPosition) * plotHeight;
              const height = isZero
                ? minimumBarHeight
                : Math.max(
                    Math.abs(valuePosition - zeroPosition) * plotHeight,
                    minimumBarHeight,
                  );
              const barTop = isZero
                ? Math.min(
                    Math.max(top - minimumBarHeight / 2, 0),
                    plotHeight - minimumBarHeight,
                  )
                : top;
              const isSelected = point.id === selected.id;
              const isPeak = point.id === peak.id;
              const isLatest = point.id === latest.id;

              return (
                <Pressable
                  accessibilityHint="轻点查看该次记录的数值"
                  accessibilityLabel={`${formatFullDate(point.timestamp)}，${formatValue(point.value)}${unit}${isPeak ? '，峰值' : ''}${isLatest ? '，最近记录' : ''}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  key={point.id}
                  onPress={() => setSelectedId(point.id)}
                  style={({ pressed }) => [
                    styles.barSlot,
                    { left: index * slotWidth, width: slotWidth },
                    pressed && styles.pressed,
                  ]}
                >
                  <View
                    style={[
                      styles.bar,
                      {
                        backgroundColor: isPeak
                          ? colors.primaryStrong
                          : isLatest
                            ? colors.primary
                            : colors.primaryTrack,
                        height,
                        left: (slotWidth - barWidth) / 2,
                        top: barTop,
                        width: barWidth,
                      },
                      point.value < 0 && styles.negativeBar,
                      isSelected && styles.selectedBar,
                    ]}
                  />
                  {dateLabelIndexes.has(index) ? (
                    <Text
                      numberOfLines={1}
                      style={[styles.date, isSelected && styles.selectedDateLabel]}
                    >
                      {formatDate(point.timestamp)}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>

      <Text style={styles.hint}>轻点柱形查看精确值</Text>
    </View>
  );
}

function ChartMessage({ message }: { message: string }) {
  return (
    <View accessibilityLabel={message} style={styles.empty}>
      <Text style={styles.emptyTitle}>{message}</Text>
    </View>
  );
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatDate(timestamp: string): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(
    new Date(timestamp),
  );
}

function formatFullDate(timestamp: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function formatAxisValue(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 10000) return `${formatValue(value / 10000)}万`;
  if (absolute >= 1000) return `${formatValue(value / 1000)}千`;
  return formatValue(value);
}

const styles = StyleSheet.create({
  chart: {
    padding: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  header: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  selectedSummary: {
    flex: 1,
    gap: 1,
  },
  selectedDate: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.caption,
  },
  selectedValueRow: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  selectedValue: {
    color: colors.text,
    fontFamily,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.pill,
    color: colors.primaryStrong,
    backgroundColor: colors.primarySoft,
    fontFamily,
    ...typography.caption,
    fontWeight: '700',
  },
  stats: {
    alignItems: 'flex-end',
    gap: 1,
  },
  stat: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  cacheNotice: {
    marginTop: 5,
    color: colors.textSecondary,
    fontFamily,
    ...typography.caption,
  },
  plotRow: {
    height: plotHeight + dateAreaHeight,
    marginTop: 8,
    flexDirection: 'row',
  },
  axis: {
    width: axisWidth,
    height: plotHeight,
  },
  axisLabel: {
    position: 'absolute',
    right: 7,
    maxWidth: axisWidth - 7,
    color: colors.textSecondary,
    fontFamily,
    ...typography.caption,
    fontVariant: ['tabular-nums'],
  },
  plotScroller: {
    flex: 1,
  },
  plot: {
    position: 'relative',
    height: plotHeight + dateAreaHeight,
    overflow: 'hidden',
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  zeroLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: colors.borderStrong,
  },
  barSlot: {
    position: 'absolute',
    top: 0,
    height: plotHeight + dateAreaHeight,
  },
  bar: {
    position: 'absolute',
    minHeight: minimumBarHeight,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  negativeBar: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
  },
  selectedBar: {
    borderWidth: 2,
    borderColor: colors.text,
  },
  date: {
    position: 'absolute',
    top: plotHeight + 7,
    left: 0,
    width: '100%',
    textAlign: 'center',
    color: colors.textSecondary,
    fontFamily,
    ...typography.caption,
  },
  selectedDateLabel: {
    color: colors.text,
    fontWeight: '700',
  },
  hint: {
    marginTop: 2,
    textAlign: 'right',
    color: colors.textSecondary,
    fontFamily,
    ...typography.caption,
  },
  pressed: {
    opacity: 0.58,
  },
  empty: {
    minHeight: 112,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  emptyTitle: {
    paddingHorizontal: 20,
    textAlign: 'center',
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
  },
  placeholder: {
    minHeight: 218,
    padding: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
    gap: 14,
  },
  placeholderText: {
    width: 104,
    height: 18,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  placeholderPlot: {
    flex: 1,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
});
