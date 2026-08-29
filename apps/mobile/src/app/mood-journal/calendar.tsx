import { errorMessage, useGetMoodJournalCalendar } from '@steward/api-client';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { StatePanel } from '@/components/ui/state-panel';
import { localDateKey, monthRange } from '@/features/mood-journal/model';
import { colors, fontFamily, moodColors, radius, typography } from '@/theme/tokens';

const weekdays = ['一', '二', '三', '四', '五', '六', '日'];

export default function MoodJournalCalendarScreen() {
  const router = useRouter();
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const range = useMemo(() => monthRange(month), [month]);
  const query = useGetMoodJournalCalendar(range);
  const counts = useMemo(() => new Map((query.data?.data ?? []).map((day) => [day.date, day.count])), [query.data?.data]);
  const cells = useMemo(() => calendarCells(month), [month]);

  const moveMonth = (offset: number) => {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  return (
    <AppScreen>
      <NavHeader title="日记日历" />
      <View style={styles.content}>
        <View style={styles.monthHeader}>
          <Pressable accessibilityLabel="上个月" accessibilityRole="button" onPress={() => moveMonth(-1)} style={styles.monthButton}>
            <AppIcon color={colors.text} name="chevron-back" size={21} />
          </Pressable>
          <Text accessibilityRole="header" style={styles.monthTitle}>{month.getFullYear()}年{month.getMonth() + 1}月</Text>
          <Pressable accessibilityLabel="下个月" accessibilityRole="button" onPress={() => moveMonth(1)} style={styles.monthButton}>
            <AppIcon color={colors.text} name="chevron-forward" size={21} />
          </Pressable>
        </View>

        <View style={styles.weekdays}>
          {weekdays.map((weekday) => <Text key={weekday} style={styles.weekday}>{weekday}</Text>)}
        </View>

        {query.isPending ? (
          <View style={styles.loading}><ActivityIndicator color={moodColors.accent} /></View>
        ) : query.isError ? (
          <StatePanel
            actionLabel="重试"
            compact
            icon="cloud-offline-outline"
            message={errorMessage(query.error, '这个月的日记暂时没有加载出来。')}
            onAction={() => void query.refetch()}
            title="日历没有加载出来"
          />
        ) : (
          <View style={styles.grid}>
            {cells.map((cell, index) => {
              if (!cell) return <View key={`blank-${index}`} style={styles.dayCell} />;
              const count = counts.get(cell.key) ?? 0;
              const isToday = cell.key === localDateKey(new Date());
              return (
                <Pressable
                  accessibilityLabel={`${cell.day}日${count ? `，有 ${count} 篇日记` : '，没有日记'}`}
                  accessibilityRole="button"
                  key={cell.key}
                  onPress={() => router.replace({ pathname: '/(tabs)/today', params: { homeTab: 'mood', date: cell.key } })}
                  style={({ pressed }) => [styles.dayCell, isToday && styles.todayCell, pressed && styles.pressed]}
                >
                  <Text style={[styles.dayText, isToday && styles.todayText]}>{cell.day}</Text>
                  {count > 0 ? (
                    <View style={styles.dayCount}>
                      <Text style={styles.dayCountText}>{count}</Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        )}

        <View style={styles.footer}>
          <View style={styles.legendDot} />
          <Text style={styles.footerText}>数字表示当天写下的日记数量</Text>
        </View>
      </View>
    </AppScreen>
  );
}

function calendarCells(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const leading = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - leading + 1;
    if (day < 1 || day > lastDay) return null;
    const date = new Date(month.getFullYear(), month.getMonth(), day);
    return { day, key: localDateKey(date) };
  });
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 12 },
  monthHeader: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  monthTitle: { color: colors.text, fontFamily, ...typography.section },
  weekdays: { marginTop: 10, flexDirection: 'row' },
  weekday: { width: '14.285%', color: colors.textSecondary, fontFamily, ...typography.meta, textAlign: 'center' },
  loading: { minHeight: 300, alignItems: 'center', justifyContent: 'center' },
  grid: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: '14.285%', height: 58, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  todayCell: { backgroundColor: moodColors.soft },
  dayText: { color: colors.text, fontFamily, ...typography.body },
  todayText: { color: moodColors.accentPressed, fontWeight: '700' },
  dayCount: { minWidth: 18, height: 18, marginTop: 2, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: moodColors.atmosphere },
  dayCountText: { color: moodColors.text, fontFamily, fontSize: 10, lineHeight: 14, fontWeight: '600' },
  footer: { marginTop: 20, paddingTop: 16, flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  legendDot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: moodColors.atmosphere },
  footerText: { color: colors.textSecondary, fontFamily, ...typography.meta },
  pressed: { opacity: 0.56 },
});
