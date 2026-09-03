import {
  errorMessage,
  useGetMoodJournalStatistics,
  useListMoodJournalEntries,
} from '@steward/api-client';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/icon';
import { StatePanel } from '@/components/ui/state-panel';
import { colors, fontFamily, moodColors, radius, typography } from '@/theme/tokens';
import {
  formatMoodDate,
  groupEntriesByDate,
  localDateKey,
  monthRange,
} from './model';
import { MoodField } from './mood-field';
import { MoodJournalEntryRow } from './mood-journal-entry-row';

export function MoodJournalContent() {
  const router = useRouter();
  const today = localDateKey(new Date());
  const currentMonth = useMemo(() => monthRange(), []);

  const entriesQuery = useListMoodJournalEntries({ from: today, to: today, limit: 50 });
  const monthEntriesQuery = useListMoodJournalEntries({ ...currentMonth, limit: 100 });
  const statisticsQuery = useGetMoodJournalStatistics(currentMonth);
  const entries = entriesQuery.data?.data ?? [];
  const grouped = groupEntriesByDate(entries);
  const monthCount = statisticsQuery.data?.data.entry_count ?? 0;
  const monthEntries = monthEntriesQuery.data?.data ?? [];
  const writeLabel = entries.length > 0 ? '再记一件事' : '写下此刻';

  return (
    <View style={styles.root}>
      <View style={styles.toolsRow}>
        <AppButton
          accessibilityLabel="搜索心情日记"
          compact
          icon="search-outline"
          label="搜索日记"
          onPress={() => router.push('/mood-journal/search')}
          style={styles.searchButton}
          variant="neutral"
        />
        <AppButton
          accessibilityLabel="按日期查看心情日记"
          compact
          icon="calendar-outline"
          label="按日期"
          onPress={() => router.push('/mood-journal/calendar')}
          variant="neutral"
        />
      </View>

      <Pressable
        accessibilityLabel={writeLabel}
        accessibilityRole="button"
        onPress={() => router.push('/mood-journal/new')}
        style={({ pressed }) => [styles.prompt, pressed && styles.promptPressed]}
      >
        <View style={styles.writeIcon}>
          <AppIcon color={moodColors.accentPressed} name="create-outline" size={20} />
        </View>
        <Text style={styles.promptTitle}>{writeLabel}</Text>
      </Pressable>

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
          <Text style={styles.emptyTitle}>今天还没有记录</Text>
        </View>
      ) : (
        <View style={styles.timeline}>
          {grouped.map((group) => (
            <View key={group.date}>
              <Text style={styles.dateHeading}>{formatMoodDate(group.date)}</Text>
              {group.entries.map((entry, index) => (
                <MoodJournalEntryRow entry={entry} key={entry.id} showDivider={index > 0} />
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

const styles = StyleSheet.create({
  root: { paddingTop: 12, paddingBottom: 16 },
  toolsRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  searchButton: { flex: 1, justifyContent: 'flex-start' },
  prompt: {
    marginTop: 10, minHeight: 60, paddingHorizontal: 12, paddingVertical: 12,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: radius.lg, backgroundColor: moodColors.soft,
  },
  promptPressed: { backgroundColor: moodColors.atmosphere },
  writeIcon: {
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    borderRadius: radius.sm, backgroundColor: colors.surfaceRaised,
  },
  promptTitle: { flex: 1, color: colors.text, fontFamily, fontSize: 17, lineHeight: 24, fontWeight: '600' },
  loading: { paddingVertical: 48, alignItems: 'center' },
  empty: { paddingVertical: 40, alignItems: 'center' },
  emptyTitle: { color: colors.text, fontFamily, ...typography.section },
  timeline: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  dateHeading: { paddingTop: 18, paddingBottom: 6, color: colors.text, fontFamily, ...typography.section },
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
