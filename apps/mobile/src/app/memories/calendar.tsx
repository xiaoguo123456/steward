import { errorMessage, useListMemoryMoments } from '@steward/api-client';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { StatePanel } from '@/components/ui/state-panel';
import { CalendarMonthGrid } from '@/features/calendar/calendar-month-grid';
import { CalendarMonthNavigator } from '@/features/calendar/calendar-month-navigator';
import {
  buildCalendarMonthCells,
  dateKeyForSelectedMonth,
  monthAnchorFromDateKey,
} from '@/features/calendar/calendar-month';
import {
  formatMemoryDateParts,
  memoriesForDate,
  memoryDatesWithCounts,
  toMemoryMoment,
} from '@/features/memories/memory-model';
import { MemoryMomentRow } from '@/features/memories/memory-moment-row';
import { colors, fontFamily, radius } from '@/theme/tokens';
import { formatDateParam } from '@/utils/format';

export default function MemoriesCalendarScreen() {
  const router = useRouter();
  const initialDate = formatDateParam(new Date());
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [monthAnchor, setMonthAnchor] = useState(() => monthAnchorFromDateKey(initialDate));
  const initializedFromData = useRef(false);
  const cells = useMemo(() => buildCalendarMonthCells(monthAnchor), [monthAnchor]);
  const query = useListMemoryMoments({
    from: cells[0].date,
    to: cells[cells.length - 1].date,
    limit: 100,
  }, {
    query: { staleTime: 3 * 60 * 1000 },
  });
  const moments = useMemo(
    () => (query.data?.data ?? []).map(toMemoryMoment),
    [query.data?.data],
  );
  const counts = useMemo(() => memoryDatesWithCounts(moments), [moments]);
  const selectedMoments = memoriesForDate(moments, selectedDate);
  const selectedLabel = formatMemoryDateParts(selectedDate).full;

  useEffect(() => {
    if (initializedFromData.current || moments.length === 0) return;
    initializedFromData.current = true;
    setSelectedDate(moments[0].date);
    setMonthAnchor(monthAnchorFromDateKey(moments[0].date));
  }, [moments]);

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
      {query.isPending ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : query.isError ? (
        <View style={styles.stateWrap}>
          <StatePanel
            actionLabel="重试"
            icon="cloud-offline-outline"
            message={errorMessage(query.error, '服务出现问题，请稍后重试。')}
            onAction={() => void query.refetch()}
            title="时光没有加载出来"
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <CalendarMonthNavigator monthAnchor={monthAnchor} onChangeMonth={changeMonth} />
          <CalendarMonthGrid
            accessibilityLabel="时光月历"
            countLabel={(count) => `${count} 段时光`}
            counts={counts}
            monthAnchor={monthAnchor}
            onSelectDate={selectDate}
            palette={{
              indicator: colors.primary,
              selectedBackground: colors.primarySoft,
              selectedBorder: colors.primary,
              selectedText: colors.primaryStrong,
              todayText: colors.primaryStrong,
            }}
            selectedDate={selectedDate}
          />

          <View style={styles.daySection}>
            <View style={styles.dayHeading}>
              <View style={styles.dayHeadingCopy}>
                <Text accessibilityRole="header" style={styles.dayTitle}>{selectedLabel}</Text>
                <Text style={styles.dayCount}>
                  {selectedMoments.length > 0 ? `${selectedMoments.length} 段时光` : '暂无时光'}
                </Text>
              </View>
              <Pressable
                accessibilityLabel="选择照片发布新时光"
                accessibilityRole="button"
                onPress={() => router.push({
                  pathname: '/memories/new',
                  params: { pick: '1' },
                })}
                style={({ pressed }) => [styles.dayAddAction, pressed && styles.pressed]}
              >
                <AppIcon color={colors.primaryStrong} name="images-outline" size={17} />
                <Text style={styles.dayAddActionText}>选照片</Text>
              </Pressable>
            </View>
            {selectedMoments.length > 0 ? (
              <View style={styles.dayMoments}>
                {selectedMoments.map((moment) => (
                  <MemoryMomentRow
                    compact
                    key={moment.id}
                    moment={moment}
                    onPress={() => router.push({
                      pathname: '/memories/[id]',
                      params: { id: moment.id },
                    })}
                  />
                ))}
              </View>
            ) : (
              <View style={styles.emptyDay}>
                <Text style={styles.emptyDayTitle}>这一天还没有时光</Text>
              </View>
            )}
          </View>
        </ScrollView>
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateWrap: {
    flex: 1,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  daySection: {
    marginTop: 30,
    paddingTop: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  dayHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  dayHeadingCopy: {
    flex: 1,
  },
  dayTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '600',
  },
  dayCount: {
    marginTop: 2,
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  dayAddAction: {
    minHeight: 44,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
  },
  dayAddActionText: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  dayMoments: {
    marginTop: 10,
    gap: 4,
  },
  emptyDay: {
    minHeight: 150,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyDayTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.58,
    backgroundColor: colors.surface,
  },
});
