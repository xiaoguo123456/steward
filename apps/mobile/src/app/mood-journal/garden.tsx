import {
  errorMessage,
  useGetMoodJournalStatistics,
  useListMoodJournalEntries,
} from '@steward/api-client';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { StatePanel } from '@/components/ui/state-panel';
import { MoodField } from '@/features/mood-journal/mood-field';
import { moodLabels, monthRange } from '@/features/mood-journal/model';
import { colors, fontFamily, moodColors, radius, typography } from '@/theme/tokens';

export default function MoodJournalGardenScreen() {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const range = useMemo(() => monthRange(month), [month]);
  const entriesQuery = useListMoodJournalEntries({ ...range, limit: 100 });
  const statisticsQuery = useGetMoodJournalStatistics(range);
  const statistics = statisticsQuery.data?.data;
  const entries = entriesQuery.data?.data ?? [];
  const failed = entriesQuery.isError || statisticsQuery.isError;
  const pending = entriesQuery.isPending || statisticsQuery.isPending;
  const dominantMood = statistics?.mood_distribution.toSorted((a, b) => b.count - a.count)[0];
  const topWords = statistics?.emotion_words.slice(0, 5) ?? [];

  const moveMonth = (offset: number) => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));

  return (
    <AppScreen>
      <NavHeader title="心情花园" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.monthHeader}>
          <Pressable accessibilityLabel="上个月" accessibilityRole="button" onPress={() => moveMonth(-1)} style={styles.monthButton}>
            <AppIcon color={colors.text} name="chevron-back" size={20} />
          </Pressable>
          <View style={styles.monthCopy}>
            <Text accessibilityRole="header" style={styles.monthTitle}>{month.getFullYear()}年{month.getMonth() + 1}月</Text>
            <Text style={styles.monthMeta}>一篇日记，成为一个安静的节点</Text>
          </View>
          <Pressable accessibilityLabel="下个月" accessibilityRole="button" onPress={() => moveMonth(1)} style={styles.monthButton}>
            <AppIcon color={colors.text} name="chevron-forward" size={20} />
          </Pressable>
        </View>

        {pending ? (
          <View style={styles.loading}><ActivityIndicator color={moodColors.accent} /></View>
        ) : failed ? (
          <StatePanel
            actionLabel="重试"
            icon="cloud-offline-outline"
            message={errorMessage(entriesQuery.error ?? statisticsQuery.error, '这个月的回望暂时没有加载出来。')}
            onAction={() => { void entriesQuery.refetch(); void statisticsQuery.refetch(); }}
            title="回望没有加载出来"
          />
        ) : (
          <>
            <View style={styles.field}>
              <MoodField height={224} seeds={entries.map((entry) => entry.visual_seed)} />
            </View>

            <View style={styles.summary}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{statistics?.entry_count ?? 0}</Text>
                <Text style={styles.summaryLabel}>篇日记</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{statistics?.writing_day_count ?? 0}</Text>
                <Text style={styles.summaryLabel}>个写作日</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text numberOfLines={1} style={styles.summaryWord}>{dominantMood ? moodLabels[dominantMood.mood_level] : '—'}</Text>
                <Text style={styles.summaryLabel}>较常出现</Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>常出现的感受</Text>
              {topWords.length > 0 ? (
                <View style={styles.words}>
                  {topWords.map((word) => (
                    <View key={word.word} style={styles.word}>
                      <Text style={styles.wordText}>{word.word}</Text>
                      <Text style={styles.wordCount}>{word.count}</Text>
                    </View>
                  ))}
                </View>
              ) : <Text style={styles.emptyText}>写日记时可以顺手选择感受词，回望会更清晰。</Text>}
            </View>

            <View style={styles.aiSection}>
              <View style={styles.aiIcon}><AppIcon color={moodColors.accent} name="sparkles-outline" size={18} /></View>
              <View style={styles.aiCopy}>
                <Text style={styles.aiTitle}>深度回望</Text>
                <Text style={styles.aiText}>你选择日记并单独同意后，AI 才会帮你寻找反复出现的主题。现在只展示本机可解释的确定性统计。</Text>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 48 },
  monthHeader: { minHeight: 72, flexDirection: 'row', alignItems: 'center' },
  monthButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  monthCopy: { flex: 1, alignItems: 'center' },
  monthTitle: { color: colors.text, fontFamily, ...typography.section },
  monthMeta: { marginTop: 2, color: colors.textSecondary, fontFamily, ...typography.meta },
  loading: { minHeight: 300, alignItems: 'center', justifyContent: 'center' },
  field: { minHeight: 224, marginTop: 6, justifyContent: 'center', overflow: 'hidden' },
  summary: { minHeight: 86, flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryDivider: { width: StyleSheet.hairlineWidth, height: 34, backgroundColor: colors.border },
  summaryValue: { color: colors.text, fontFamily, ...typography.metric },
  summaryWord: { maxWidth: 86, color: colors.text, fontFamily, fontSize: 18, lineHeight: 28, fontWeight: '600' },
  summaryLabel: { marginTop: 2, color: colors.textSecondary, fontFamily, ...typography.meta },
  section: { paddingTop: 24 },
  sectionTitle: { color: colors.text, fontFamily, ...typography.section },
  words: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  word: { minHeight: 40, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: radius.pill, backgroundColor: moodColors.soft },
  wordText: { color: moodColors.accentPressed, fontFamily, ...typography.label },
  wordCount: { color: moodColors.text, fontFamily, ...typography.meta },
  emptyText: { marginTop: 8, color: colors.textSecondary, fontFamily, ...typography.body },
  aiSection: { marginTop: 28, paddingTop: 20, flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  aiIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: moodColors.soft },
  aiCopy: { flex: 1 },
  aiTitle: { color: colors.text, fontFamily, ...typography.bodyStrong },
  aiText: { marginTop: 4, color: colors.textSecondary, fontFamily, ...typography.meta },
});
