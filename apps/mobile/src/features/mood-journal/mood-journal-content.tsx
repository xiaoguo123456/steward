import {
  errorMessage,
  useGetMoodJournalCalendar,
  useGetMoodJournalStatistics,
  useListMoodJournalEntries,
  type MoodJournalEntry,
} from '@steward/api-client';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/components/ui/icon';
import { StatePanel } from '@/components/ui/state-panel';
import { colors, fontFamily, moodColors, radius, typography } from '@/theme/tokens';
import {
  entryMoodText,
  entryTime,
  formatMoodDate,
  groupEntriesByDate,
  localDateKey,
  monthRange,
  recentSevenDays,
} from './model';
import { MoodField } from './mood-field';

export function MoodJournalContent({ initialDate }: { initialDate?: string }) {
  const router = useRouter();
  const today = localDateKey(new Date());
  const [selectedDate, setSelectedDate] = useState(/^\d{4}-\d{2}-\d{2}$/.test(initialDate ?? '') ? initialDate! : today);
  const days = useMemo(() => recentSevenDays(), []);
  const currentMonth = useMemo(() => monthRange(), []);

  const entriesQuery = useListMoodJournalEntries({ from: selectedDate, to: selectedDate, limit: 50 });
  const monthEntriesQuery = useListMoodJournalEntries({ ...currentMonth, limit: 100 });
  const calendarQuery = useGetMoodJournalCalendar(currentMonth);
  const statisticsQuery = useGetMoodJournalStatistics(currentMonth);
  const entries = entriesQuery.data?.data ?? [];
  const grouped = groupEntriesByDate(entries);
  const daysWithEntries = new Set((calendarQuery.data?.data ?? []).map((day) => day.date));
  const monthCount = statisticsQuery.data?.data.entry_count ?? 0;
  const monthEntries = monthEntriesQuery.data?.data ?? [];
  const todayCount = selectedDate === today ? entries.length : 0;

  return (
    <View style={styles.root}>
      <View style={styles.toolsRow}>
        <UtilityButton
          label="打开日记日历"
          name="calendar-outline"
          onPress={() => router.push('/mood-journal/calendar')}
          text="日历"
        />
        <UtilityButton
          label="搜索心情日记"
          name="search-outline"
          onPress={() => router.push('/mood-journal/search')}
          text="搜索"
        />
      </View>

      <Pressable
        accessibilityLabel={selectedDate === today ? '写下此刻' : '补写这一天'}
        accessibilityRole="button"
        onPress={() => router.push({ pathname: '/mood-journal/new', params: { date: selectedDate } })}
        style={({ pressed }) => [styles.prompt, pressed && styles.promptPressed]}
      >
        <View style={styles.promptCopy}>
          <Text style={styles.promptTitle}>
            {selectedDate === today
              ? todayCount > 0 ? '再记一件刚刚发生的事' : '今天想留下什么？'
              : '想为这一天留下什么？'}
          </Text>
          <Text style={styles.promptMeta}>只有你可以查看；心情和标题都可以跳过</Text>
        </View>
        <View style={styles.writeAction}>
          <AppIcon color={moodColors.accent} name="create-outline" size={17} />
          <Text style={styles.writeActionText}>{selectedDate === today ? '写下此刻' : '补写这一天'}</Text>
        </View>
      </Pressable>

      <ScrollView
        accessibilityRole="tablist"
        contentContainerStyle={styles.dateRail}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {days.map((day) => {
          const selected = selectedDate === day.key;
          const hasEntry = daysWithEntries.has(day.key);
          return (
            <Pressable
              accessibilityLabel={`${day.weekday} ${day.day} 日${hasEntry ? '，有日记' : ''}`}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              key={day.key}
              onPress={() => setSelectedDate(day.key)}
              style={({ pressed }) => [
                styles.dateItem,
                selected && styles.dateItemSelected,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.weekday, selected && styles.weekdaySelected]}>{day.weekday}</Text>
              <Text style={[styles.day, selected && styles.daySelected]}>{day.day}</Text>
              <View style={[styles.dateDot, hasEntry && styles.dateDotVisible, selected && styles.dateDotSelected]} />
            </Pressable>
          );
        })}
      </ScrollView>

      {entriesQuery.isPending ? (
        <View style={styles.loading}><ActivityIndicator color={moodColors.accent} /></View>
      ) : entriesQuery.isError ? (
        <StatePanel
          actionLabel="重试"
          compact
          icon="cloud-offline-outline"
          message={errorMessage(entriesQuery.error, '暂时无法加载这一天的日记。')}
          onAction={() => void entriesQuery.refetch()}
          title="日记没有加载出来"
        />
      ) : entries.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{selectedDate === today ? '今天还没有写日记' : '这一天还没有日记'}</Text>
          <Text style={styles.emptyText}>一句话也可以，写下刚刚发生的事。</Text>
        </View>
      ) : (
        <View style={styles.timeline}>
          {grouped.map((group) => (
            <View key={group.date}>
              <Text style={styles.dateHeading}>{formatMoodDate(group.date)}</Text>
              {group.entries.map((entry, index) => (
                <TimelineEntry entry={entry} key={entry.id} showDivider={index > 0} />
              ))}
            </View>
          ))}
        </View>
      )}

      {monthCount > 0 ? (
        <Pressable
          accessibilityLabel={`打开本月回望，本月写了 ${monthCount} 篇`}
          accessibilityRole="button"
          onPress={() => router.push('/mood-journal/garden')}
          style={({ pressed }) => [styles.reflectionRow, pressed && styles.pressed]}
        >
          <View style={styles.reflectionIcon}>
            <AppIcon color={moodColors.accent} name="stats-chart-outline" size={18} />
          </View>
          <View style={styles.reflectionCopy}>
            <Text style={styles.reflectionTitle}>本月回望</Text>
            <Text style={styles.reflectionMeta}>本月写了 {monthCount} 篇</Text>
          </View>
          <AppIcon color={colors.textTertiary} name="chevron-forward" size={18} />
        </Pressable>
      ) : null}

      <View style={styles.gardenSection}>
        <View style={styles.gardenHeader}>
          <Text style={styles.gardenTitle}>{new Date().getMonth() + 1}月 · 心情花园</Text>
          <Pressable
            accessibilityLabel="查看心情花园"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.push('/mood-journal/garden')}
          >
            <Text style={styles.gardenLink}>查看花园</Text>
          </Pressable>
        </View>
        <View style={styles.gardenPreview}>
          <MoodField compact height={90} seeds={monthEntries.map((entry) => entry.visual_seed)} />
        </View>
      </View>
    </View>
  );
}

function UtilityButton({ label, name, onPress, text }: {
  label: string;
  name: 'calendar-outline' | 'search-outline';
  onPress: () => void;
  text: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.utilityButton, pressed && styles.pressed]}
    >
      <AppIcon color={colors.textSecondary} name={name} size={18} />
      <Text style={styles.utilityButtonText}>{text}</Text>
    </Pressable>
  );
}

function TimelineEntry({ entry, showDivider }: { entry: MoodJournalEntry; showDivider: boolean }) {
  const router = useRouter();
  const moodText = entryMoodText(entry);
  return (
    <Pressable
      accessibilityLabel={`${entryTime(entry)}，${entry.content_plaintext}`}
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/mood-journal/[id]', params: { id: entry.id } })}
      style={({ pressed }) => [styles.entry, showDivider && styles.entryDivider, pressed && styles.entryPressed]}
    >
      <Text style={styles.entryTime}>{entryTime(entry)}</Text>
      <View style={styles.entryBody}>
        <Text numberOfLines={4} style={styles.entryText}>{entry.content_plaintext}</Text>
        {moodText ? (
          <View style={styles.moodMeta}>
            <View style={styles.moodGlyph} />
            <Text style={styles.moodText}>{moodText}</Text>
          </View>
        ) : null}
      </View>
      <AppIcon color={colors.textTertiary} name="chevron-forward" size={16} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { paddingTop: 12, paddingBottom: 16 },
  toolsRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 2 },
  utilityButton: {
    minHeight: 44, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderRadius: radius.sm,
  },
  utilityButtonText: { color: colors.textSecondary, fontFamily, ...typography.label },
  prompt: {
    marginTop: 6, minHeight: 86, paddingHorizontal: 16, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: radius.lg, backgroundColor: colors.surfaceSubtle,
  },
  promptPressed: { backgroundColor: moodColors.soft },
  promptCopy: { flex: 1, minWidth: 0 },
  promptTitle: { color: colors.text, fontFamily, fontSize: 18, lineHeight: 26, fontWeight: '600' },
  promptMeta: { marginTop: 4, color: colors.textSecondary, fontFamily, ...typography.meta },
  writeAction: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 5 },
  writeActionText: { color: moodColors.accentPressed, fontFamily, ...typography.bodyStrong },
  dateRail: { minWidth: '100%', paddingVertical: 18, justifyContent: 'space-between', gap: 4 },
  dateItem: { width: 44, minHeight: 72, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  dateItemSelected: { backgroundColor: moodColors.soft },
  weekday: { color: colors.textSecondary, fontFamily, ...typography.meta },
  weekdaySelected: { color: moodColors.accentPressed, fontWeight: '600' },
  day: { marginTop: 3, color: colors.text, fontFamily, fontSize: 17, lineHeight: 24, fontWeight: '500' },
  daySelected: { color: colors.text, fontWeight: '700' },
  dateDot: { width: 4, height: 4, marginTop: 5, borderRadius: radius.pill, backgroundColor: 'transparent' },
  dateDotVisible: { backgroundColor: colors.textTertiary },
  dateDotSelected: { backgroundColor: moodColors.accent },
  loading: { paddingVertical: 48, alignItems: 'center' },
  empty: { paddingVertical: 40, alignItems: 'center' },
  emptyTitle: { color: colors.text, fontFamily, ...typography.section },
  emptyText: { marginTop: 6, color: colors.textSecondary, fontFamily, ...typography.meta },
  timeline: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  dateHeading: { paddingTop: 18, paddingBottom: 6, color: colors.text, fontFamily, ...typography.section },
  entry: { minHeight: 116, paddingVertical: 16, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  entryDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  entryPressed: { opacity: 0.58 },
  entryTime: { width: 43, color: colors.textSecondary, fontFamily, ...typography.meta },
  entryBody: { flex: 1, minWidth: 0 },
  entryText: { color: colors.text, fontFamily, fontSize: 16, lineHeight: 25 },
  moodMeta: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 7 },
  moodGlyph: { width: 8, height: 8, borderWidth: 2, borderColor: moodColors.accent, borderRadius: radius.pill },
  moodText: { color: colors.textSecondary, fontFamily, ...typography.meta },
  reflectionRow: {
    minHeight: 68, marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  reflectionIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: moodColors.soft },
  reflectionCopy: { flex: 1 },
  reflectionTitle: { color: colors.text, fontFamily, ...typography.bodyStrong },
  reflectionMeta: { marginTop: 1, color: colors.textSecondary, fontFamily, ...typography.meta },
  gardenSection: { paddingTop: 20 },
  gardenHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gardenTitle: { color: colors.text, fontFamily, ...typography.section },
  gardenLink: { color: moodColors.accentPressed, fontFamily, ...typography.label },
  gardenPreview: { marginTop: 6, height: 90, overflow: 'hidden' },
  pressed: { opacity: 0.58 },
});
