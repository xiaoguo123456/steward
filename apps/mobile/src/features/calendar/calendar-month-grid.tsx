import type { StyleProp, ViewStyle } from 'react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, radius, typography } from '@/theme/tokens';
import { formatDateParam } from '@/utils/format';
import { buildCalendarMonthCells } from './calendar-month';

const weekDays = ['日', '一', '二', '三', '四', '五', '六'];

export type CalendarMonthPalette = {
  indicator: string;
  selectedBackground: string;
  selectedText: string;
  selectedBorder?: string;
  todayText?: string;
};

export function CalendarMonthGrid({
  accessibilityLabel,
  countLabel,
  counts,
  monthAnchor,
  onSelectDate,
  palette,
  selectedDate,
  style,
}: {
  accessibilityLabel: string;
  countLabel: (count: number) => string;
  counts: ReadonlyMap<string, number>;
  monthAnchor: Date;
  onSelectDate: (date: string) => void;
  palette: CalendarMonthPalette;
  selectedDate: string;
  style?: StyleProp<ViewStyle>;
}) {
  const cells = buildCalendarMonthCells(monthAnchor);
  const todayKey = formatDateParam(new Date());

  return (
    <View accessibilityLabel={accessibilityLabel} style={style}>
      <View style={styles.weekRow}>
        {weekDays.map((label) => (
          <Text key={label} style={styles.weekLabel}>{label}</Text>
        ))}
      </View>
      <View style={styles.grid}>
        {cells.map((cell) => {
          const count = counts.get(cell.date) ?? 0;
          const selected = cell.date === selectedDate;
          const today = cell.date === todayKey;
          return (
            <Pressable
              accessibilityLabel={`${cell.date}，${count > 0 ? countLabel(count) : '没有内容'}`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              key={cell.date}
              onPress={() => onSelectDate(cell.date)}
              style={({ pressed }) => [styles.cell, pressed && styles.cellPressed]}
            >
              <View style={[
                styles.dayCircle,
                selected && { backgroundColor: palette.selectedBackground },
                selected && palette.selectedBorder
                  ? { borderWidth: 1.5, borderColor: palette.selectedBorder }
                  : null,
                today && !selected ? styles.dayCircleToday : null,
              ]}>
                <Text style={[
                  styles.dayText,
                  cell.muted && styles.dayTextMuted,
                  today && { color: palette.todayText ?? palette.selectedText, fontWeight: '700' },
                  selected && { color: palette.selectedText, fontWeight: '700' },
                  count > 0 && styles.dayTextWithIndicator,
                ]}>{cell.day}</Text>
                {count > 0 ? (
                  <View style={[styles.dot, { backgroundColor: palette.indicator }]} />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  weekRow: { minHeight: 30, flexDirection: 'row', alignItems: 'center' },
  weekLabel: {
    width: '14.285%',
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    textAlign: 'center',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: '14.285%',
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  cellPressed: { opacity: 0.56, backgroundColor: colors.surface },
  dayCircle: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  dayCircleToday: { borderWidth: 1, borderColor: colors.borderStrong },
  dayText: {
    color: colors.text,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  dayTextMuted: { color: colors.textTertiary },
  dayTextWithIndicator: { transform: [{ translateY: -4 }] },
  dot: {
    position: 'absolute',
    bottom: 5,
    width: 5,
    height: 5,
    borderRadius: radius.pill,
  },
});
