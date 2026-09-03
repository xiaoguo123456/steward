import { errorMessage, useListMoodJournalEntries } from '@steward/api-client';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { NavHeader } from '@/components/ui/nav-header';
import { StatePanel } from '@/components/ui/state-panel';
import {
  dateKeyForSelectedMonth,
  formatCalendarDayTitle,
  monthAnchorFromDateKey,
} from '@/features/calendar/calendar-month';
import { CalendarMonthNavigator } from '@/features/calendar/calendar-month-navigator';
import { localDateKey } from '@/features/mood-journal/model';
import { MoodCalendar } from '@/features/mood-journal/mood-calendar';
import { MoodJournalEntryRow } from '@/features/mood-journal/mood-journal-entry-row';
import { colors, fontFamily, moodColors, typography } from '@/theme/tokens';

export default function MoodJournalCalendarScreen() {
  const today = localDateKey(new Date());
  const [selectedDate, setSelectedDate] = useState(today);
  const [monthAnchor, setMonthAnchor] = useState(() => monthAnchorFromDateKey(today));
  const entriesQuery = useListMoodJournalEntries({ from: selectedDate, to: selectedDate, limit: 50 });
  const entries = entriesQuery.data?.data ?? [];

  const changeMonth = (next: Date) => {
    setMonthAnchor(next);
    setSelectedDate(dateKeyForSelectedMonth(next, new Date()));
  };

  const selectDate = (date: string) => {
    setSelectedDate(date);
    const selectedMonth = monthAnchorFromDateKey(date);
    if (
      selectedMonth.getFullYear() !== monthAnchor.getFullYear()
      || selectedMonth.getMonth() !== monthAnchor.getMonth()
    ) {
      setMonthAnchor(selectedMonth);
    }
  };

  return (
    <AppScreen includeBottomInset>
      <NavHeader title="按日期查找" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <CalendarMonthNavigator
          monthAnchor={monthAnchor}
          onChangeMonth={changeMonth}
          selectedBackground={moodColors.soft}
          selectedText={moodColors.accentPressed}
        />

        <MoodCalendar
          monthAnchor={monthAnchor}
          onSelectDate={selectDate}
          selectedDate={selectedDate}
        />

        <View style={styles.daySection}>
          <View>
            <Text accessibilityRole="header" style={styles.dayTitle}>
              {formatCalendarDayTitle(selectedDate)}
            </Text>
            <Text style={styles.dayCount}>
              {entriesQuery.isPending
                ? '正在加载'
                : entries.length > 0 ? `${entries.length} 篇日记` : '暂无日记'}
            </Text>
          </View>

          {entriesQuery.isPending ? (
            <View style={styles.dayLoading}>
              <ActivityIndicator color={moodColors.accent} />
            </View>
          ) : entriesQuery.isError ? (
            <View style={styles.dayState}>
              <StatePanel
                actionLabel="重试"
                compact
                icon="cloud-offline-outline"
                message={errorMessage(entriesQuery.error, '这一天的日记暂时没有加载出来。')}
                onAction={() => void entriesQuery.refetch()}
                title="日记没有加载出来"
              />
            </View>
          ) : entries.length > 0 ? (
            <View style={styles.entries}>
              {entries.map((entry, index) => (
                <MoodJournalEntryRow entry={entry} key={entry.id} showDivider={index > 0} />
              ))}
            </View>
          ) : (
            <View style={styles.emptyDay}>
              <Text style={styles.emptyDayTitle}>这一天还没有记录</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  daySection: {
    marginTop: 24,
    paddingTop: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  dayTitle: { color: colors.text, fontFamily, fontSize: 18, lineHeight: 26, fontWeight: '600' },
  dayCount: { marginTop: 2, color: moodColors.text, fontFamily, ...typography.meta },
  dayLoading: { minHeight: 150, alignItems: 'center', justifyContent: 'center' },
  dayState: { paddingVertical: 18 },
  entries: { marginTop: 10 },
  emptyDay: { minHeight: 150, alignItems: 'center', justifyContent: 'center' },
  emptyDayTitle: { color: colors.text, fontFamily, ...typography.label },
});
