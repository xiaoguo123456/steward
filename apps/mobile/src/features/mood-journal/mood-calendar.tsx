import { errorMessage, useGetMoodJournalCalendar } from '@steward/api-client';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { StatePanel } from '@/components/ui/state-panel';
import {
  buildCalendarMonthCells,
  calendarMonthRange,
} from '@/features/calendar/calendar-month';
import { colors, fontFamily, moodColors, radius, typography } from '@/theme/tokens';
import { localDateKey } from './model';

const weekDays = ['日', '一', '二', '三', '四', '五', '六'];

type MoodCalendarProps = {
  monthAnchor: Date;
  onSelectDate: (date: string) => void;
  selectedDate: string;
};

/**
 * 日期条的内联月历。它只读取正式日历投影，不复制日记事实，选中日期后由首页负责收起。
 */
export function MoodCalendar({ monthAnchor, onSelectDate, selectedDate }: MoodCalendarProps) {
  const cells = useMemo(() => buildCalendarMonthCells(monthAnchor), [monthAnchor]);
  const range = useMemo(() => calendarMonthRange(monthAnchor), [monthAnchor]);
  const query = useGetMoodJournalCalendar(range, {
    query: { staleTime: 3 * 60 * 1000 },
  });
  const counts = useMemo(
    () => new Map((query.data?.data ?? []).map((day) => [day.date, day.count])),
    [query.data?.data],
  );

  return (
    <View accessibilityLabel="日记月历" style={styles.container}>
      {query.isPending ? (
        <View style={styles.loading}>
          <ActivityIndicator color={moodColors.accent} />
        </View>
      ) : query.isError ? (
        <View style={styles.errorState}>
          <StatePanel
            actionLabel="重试"
            compact
            icon="cloud-offline-outline"
            message={errorMessage(query.error, '这个月的日记暂时没有加载出来。')}
            onAction={() => void query.refetch()}
            title="月历没有加载出来"
          />
        </View>
      ) : (
        <>
          <View style={styles.weekRow}>
            {weekDays.map((label) => <Text key={label} style={styles.weekLabel}>{label}</Text>)}
          </View>
          <View style={styles.grid}>
            {cells.map((cell) => {
              const count = counts.get(cell.date) ?? 0;
              const selected = cell.date === selectedDate;
              const today = cell.date === localDateKey(new Date());
              return (
                <Pressable
                  accessibilityLabel={`${cell.date}，${count ? `${count} 篇日记` : '没有日记'}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={cell.date}
                  onPress={() => onSelectDate(cell.date)}
                  style={({ pressed }) => [styles.dayCell, pressed && styles.dayCellPressed]}
                >
                  <View style={[styles.dayCircle, selected && styles.dayCircleSelected]}>
                    <Text
                      style={[
                        styles.dayText,
                        cell.muted && styles.dayTextMuted,
                        today && styles.todayText,
                        selected && styles.dayTextSelected,
                      ]}
                    >
                      {cell.day}
                    </Text>
                  </View>
                  <View style={styles.countSlot}>
                    {count > 0 ? (
                      <View style={styles.countBadge}>
                        <Text style={styles.countText}>{count}</Text>
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 8,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 10,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  loading: { minHeight: 268, alignItems: 'center', justifyContent: 'center' },
  errorState: { paddingHorizontal: 8, paddingVertical: 24 },
  weekRow: { minHeight: 28, flexDirection: 'row', alignItems: 'center' },
  weekLabel: {
    width: '14.285%',
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    textAlign: 'center',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: {
    width: '14.285%',
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  dayCellPressed: { backgroundColor: moodColors.soft },
  dayCircle: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  dayCircleSelected: { backgroundColor: moodColors.atmosphere },
  dayText: { color: colors.text, fontFamily, ...typography.label },
  dayTextMuted: { color: colors.textTertiary },
  todayText: { color: moodColors.accentPressed, fontWeight: '700' },
  dayTextSelected: { color: moodColors.text, fontWeight: '700' },
  countSlot: { height: 16, alignItems: 'center', justifyContent: 'center' },
  countBadge: {
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: moodColors.atmosphere,
  },
  countText: { color: moodColors.text, fontFamily, fontSize: 10, lineHeight: 14, fontWeight: '700' },
  pressed: { opacity: 0.56 },
});
