import { errorMessage, useListMoodJournalEntries } from '@steward/api-client';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { ModalSheet } from '@/components/ui/modal-sheet';
import { NavHeader } from '@/components/ui/nav-header';
import { StatePanel } from '@/components/ui/state-panel';
import {
  dateKeyForSelectedMonth,
  formatCalendarDayTitle,
  formatCalendarMonthTitle,
  monthAnchorFromDateKey,
} from '@/features/calendar/calendar-month';
import { localDateKey } from '@/features/mood-journal/model';
import { MoodCalendar } from '@/features/mood-journal/mood-calendar';
import { MoodJournalEntryRow } from '@/features/mood-journal/mood-journal-entry-row';
import { colors, fontFamily, moodColors, radius, typography } from '@/theme/tokens';

const months = Array.from({ length: 12 }, (_, index) => index);

export default function MoodJournalCalendarScreen() {
  const router = useRouter();
  const today = localDateKey(new Date());
  const [selectedDate, setSelectedDate] = useState(today);
  const [monthAnchor, setMonthAnchor] = useState(() => monthAnchorFromDateKey(today));
  const [monthPickerVisible, setMonthPickerVisible] = useState(false);
  const [pickerYear, setPickerYear] = useState(() => monthAnchor.getFullYear());
  const entriesQuery = useListMoodJournalEntries({ from: selectedDate, to: selectedDate, limit: 50 });
  const entries = entriesQuery.data?.data ?? [];

  const shiftMonth = (offset: number) => {
    const next = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + offset, 1);
    setMonthAnchor(next);
    setSelectedDate(dateKeyForSelectedMonth(next, new Date()));
  };

  const openMonthPicker = () => {
    setPickerYear(monthAnchor.getFullYear());
    setMonthPickerVisible(true);
  };

  const chooseMonth = (year: number, month: number) => {
    const next = new Date(year, month, 1);
    setMonthAnchor(next);
    setSelectedDate(dateKeyForSelectedMonth(next, new Date()));
    setMonthPickerVisible(false);
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
        <View style={styles.monthBar}>
          <Pressable
            accessibilityLabel="上个月"
            accessibilityRole="button"
            onPress={() => shiftMonth(-1)}
            style={({ pressed }) => [styles.monthArrow, pressed && styles.pressed]}
          >
            <AppIcon name="chevron-back" size={21} />
          </Pressable>
          <Pressable
            accessibilityLabel={`选择月份，当前 ${formatCalendarMonthTitle(monthAnchor)}`}
            accessibilityRole="button"
            onPress={openMonthPicker}
            style={({ pressed }) => [styles.monthTitleButton, pressed && styles.pressed]}
          >
            <Text style={styles.monthTitle}>{formatCalendarMonthTitle(monthAnchor)}</Text>
            <AppIcon color={colors.textSecondary} name="chevron-down" size={16} />
          </Pressable>
          <Pressable
            accessibilityLabel="下个月"
            accessibilityRole="button"
            onPress={() => shiftMonth(1)}
            style={({ pressed }) => [styles.monthArrow, pressed && styles.pressed]}
          >
            <AppIcon name="chevron-forward" size={21} />
          </Pressable>
        </View>

        <MoodCalendar
          monthAnchor={monthAnchor}
          onSelectDate={selectDate}
          selectedDate={selectedDate}
        />

        <View style={styles.daySection}>
          <View style={styles.dayHeading}>
            <View style={styles.dayHeadingCopy}>
              <Text accessibilityRole="header" style={styles.dayTitle}>
                {formatCalendarDayTitle(selectedDate)}
              </Text>
              <Text style={styles.dayCount}>
                {entriesQuery.isPending
                  ? '正在加载'
                  : entries.length > 0 ? `${entries.length} 篇日记` : '暂无日记'}
              </Text>
            </View>
            <AppButton
              accessibilityLabel={`${selectedDate === today ? '写下此刻' : '补写这一天'}，${formatCalendarDayTitle(selectedDate)}`}
              compact
              icon="create-outline"
              label={selectedDate === today ? '写日记' : '补写'}
              onPress={() => router.push({ pathname: '/mood-journal/new', params: { date: selectedDate } })}
              variant="secondary"
            />
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

      <Modal
        animationType="fade"
        onRequestClose={() => setMonthPickerVisible(false)}
        transparent
        visible={monthPickerVisible}
      >
        <ModalSheet maxHeight="62%" onClose={() => setMonthPickerVisible(false)}>
          <View style={styles.pickerHeader}>
            <Text accessibilityRole="header" style={styles.pickerTitle}>选择月份</Text>
            <Pressable
              accessibilityLabel="关闭月份选择"
              accessibilityRole="button"
              onPress={() => setMonthPickerVisible(false)}
              style={styles.pickerClose}
            >
              <AppIcon name="close" size={22} />
            </Pressable>
          </View>
          <View style={styles.yearBar}>
            <Pressable
              accessibilityLabel="上一年"
              accessibilityRole="button"
              onPress={() => setPickerYear((year) => year - 1)}
              style={styles.yearButton}
            >
              <AppIcon name="chevron-back" size={20} />
            </Pressable>
            <Text style={styles.yearText}>{pickerYear} 年</Text>
            <Pressable
              accessibilityLabel="下一年"
              accessibilityRole="button"
              onPress={() => setPickerYear((year) => year + 1)}
              style={styles.yearButton}
            >
              <AppIcon name="chevron-forward" size={20} />
            </Pressable>
          </View>
          <View style={styles.monthGrid}>
            {months.map((month) => {
              const selected = pickerYear === monthAnchor.getFullYear()
                && month === monthAnchor.getMonth();
              return (
                <Pressable
                  accessibilityLabel={`${pickerYear}年${month + 1}月`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={month}
                  onPress={() => chooseMonth(pickerYear, month)}
                  style={({ pressed }) => [
                    styles.monthOption,
                    selected && styles.monthOptionSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[
                    styles.monthOptionText,
                    selected && styles.monthOptionTextSelected,
                  ]}>{month + 1}月</Text>
                </Pressable>
              );
            })}
          </View>
        </ModalSheet>
      </Modal>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  monthBar: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  monthArrow: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  monthTitleButton: {
    minHeight: 48,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: radius.md,
  },
  monthTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  daySection: {
    marginTop: 24,
    paddingTop: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  dayHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  dayHeadingCopy: { flex: 1 },
  dayTitle: { color: colors.text, fontFamily, fontSize: 18, lineHeight: 26, fontWeight: '600' },
  dayCount: { marginTop: 2, color: moodColors.text, fontFamily, ...typography.meta },
  dayLoading: { minHeight: 150, alignItems: 'center', justifyContent: 'center' },
  dayState: { paddingVertical: 18 },
  entries: { marginTop: 10 },
  emptyDay: { minHeight: 150, alignItems: 'center', justifyContent: 'center' },
  emptyDayTitle: { color: colors.text, fontFamily, ...typography.label },
  pressed: { opacity: 0.58, backgroundColor: colors.surface },
  pickerHeader: {
    height: 54,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerTitle: { color: colors.text, fontFamily, ...typography.bodyStrong },
  pickerClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  yearBar: {
    height: 56,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  yearButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  yearText: { color: colors.text, fontFamily, ...typography.section, fontVariant: ['tabular-nums'] },
  monthGrid: { paddingHorizontal: 16, paddingBottom: 24, flexDirection: 'row', flexWrap: 'wrap' },
  monthOption: {
    width: '33.333%',
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  monthOptionSelected: { backgroundColor: moodColors.soft },
  monthOptionText: { color: colors.textSecondary, fontFamily, ...typography.label },
  monthOptionTextSelected: { color: moodColors.accentPressed, fontWeight: '700' },
});
