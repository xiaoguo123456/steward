import { errorMessage, useGetMoodJournalCalendar } from '@steward/api-client';
import { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { StatePanel } from '@/components/ui/state-panel';
import { calendarMonthRange } from '@/features/calendar/calendar-month';
import { CalendarMonthGrid } from '@/features/calendar/calendar-month-grid';
import { colors, moodColors, radius } from '@/theme/tokens';

type MoodCalendarProps = {
  monthAnchor: Date;
  onSelectDate: (date: string) => void;
  selectedDate: string;
};

/** 独立日期查找页中的月历，只读取正式日历投影，不复制日记事实。 */
export function MoodCalendar({ monthAnchor, onSelectDate, selectedDate }: MoodCalendarProps) {
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
        <CalendarMonthGrid
          accessibilityLabel="心情日记月历"
          countLabel={(count) => `${count} 篇日记`}
          counts={counts}
          monthAnchor={monthAnchor}
          onSelectDate={onSelectDate}
          palette={{
            indicator: moodColors.accentPressed,
            selectedBackground: moodColors.atmosphere,
            selectedText: moodColors.text,
            todayText: moodColors.accentPressed,
          }}
          selectedDate={selectedDate}
        />
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
});
