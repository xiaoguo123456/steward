import {
  errorMessage,
  generateMoodJournalReflection,
  useGetMoodJournalStatistics,
  useListMoodJournalEntries,
  type MoodJournalReflectionResult,
} from '@steward/api-client';
import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { StatePanel } from '@/components/ui/state-panel';
import { MoodField } from '@/features/mood-journal/mood-field';
import {
  localDateKey,
  moodLabels,
  monthRange,
  mostFrequentMood,
} from '@/features/mood-journal/model';
import { useMoodJournalAiConsent } from '@/features/mood-journal/use-mood-journal-ai-consent';
import { colors, fontFamily, moodColors, radius, typography } from '@/theme/tokens';

export default function MoodJournalGardenScreen() {
  const router = useRouter();
  const ensureAiConsent = useMoodJournalAiConsent();
  const [period, setPeriod] = useState<'week' | 'month'>('month');
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const range = useMemo(() => period === 'month' ? monthRange(month) : currentWeekRange(), [month, period]);
  const entriesQuery = useListMoodJournalEntries({ ...range, limit: 100 });
  const statisticsQuery = useGetMoodJournalStatistics(range);
  const statistics = statisticsQuery.data?.data;
  const entries = entriesQuery.data?.data ?? [];
  const failed = entriesQuery.isError || statisticsQuery.isError;
  const pending = entriesQuery.isPending || statisticsQuery.isPending;
  const dominantMood = mostFrequentMood(statistics?.mood_distribution ?? []);
  const topWords = statistics?.emotion_words.slice(0, 5) ?? [];
  const eligibleEntries = entries.filter((entry) => !entry.exclude_from_ai);
  const [selected, setSelected] = useState<string[]>([]);
  const [reflection, setReflection] = useState<MoodJournalReflectionResult | null>(null);
  const [reflectionFailure, setReflectionFailure] = useState<string | null>(null);
  const [reflecting, setReflecting] = useState(false);

  const moveMonth = (offset: number) => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  const toggleSelected = (id: string) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const generateReflection = async () => {
    if (selected.length === 0 || reflecting) return;
    setReflecting(true);
    setReflectionFailure(null);
    try {
      if (!await ensureAiConsent('selected')) return;
      const response = await generateMoodJournalReflection({ period_start: range.from, period_end: range.to, entry_ids: selected });
      setReflection(response.data);
    } catch (error) {
      setReflectionFailure(errorMessage(error, '深度回望暂时不可用；上方确定性统计仍然有效。'));
    } finally {
      setReflecting(false);
    }
  };

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
        <View style={styles.periodTabs}>
          {(['week', 'month'] as const).map((value) => (
            <Pressable accessibilityRole="button" key={value} onPress={() => { setPeriod(value); setSelected([]); setReflection(null); }} style={[styles.periodTab, period === value && styles.periodTabActive]}>
              <Text style={[styles.periodTabText, period === value && styles.periodTabTextActive]}>{value === 'week' ? '本周' : '本月'}</Text>
            </Pressable>
          ))}
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
              <MoodField
                height={224}
                onSelect={(index) => {
                  const entry = entries[index];
                  if (entry) router.push({ pathname: '/mood-journal/[id]', params: { id: entry.id } });
                }}
                seeds={entries.map((entry) => entry.visual_seed)}
              />
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
                <Text style={styles.aiText}>先选择允许用于本次回望的日记。未选择或未同意时，只展示上方由服务端确定性计算的统计。</Text>
              </View>
            </View>
            <View style={styles.entryChoices}>
              {eligibleEntries.map((entry) => {
                const active = selected.includes(entry.id);
                return (
                  <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: active }} key={entry.id} onPress={() => toggleSelected(entry.id)} style={styles.choiceRow}>
                    <AppIcon color={active ? moodColors.accent : colors.textTertiary} name={active ? 'checkmark-circle' : 'ellipse-outline'} size={21} />
                    <View style={styles.choiceCopy}>
                      <Text numberOfLines={1} style={styles.choiceTitle}>{entry.title || entry.content_plaintext}</Text>
                      <Text style={styles.choiceDate}>{new Date(entry.occurred_at).toLocaleDateString('zh-CN')}</Text>
                    </View>
                  </Pressable>
                );
              })}
              {entries.some((entry) => entry.exclude_from_ai) ? <Text style={styles.excludedText}>已排除 AI 的日记不会出现在选择范围中。</Text> : null}
              <Pressable accessibilityRole="button" disabled={selected.length === 0 || reflecting} onPress={() => void generateReflection()} style={[styles.generateButton, (selected.length === 0 || reflecting) && styles.generateButtonDisabled]}>
                <Text style={styles.generateButtonText}>{reflecting ? '正在生成…' : `生成 ${period === 'week' ? '本周' : '本月'} AI 回望`}</Text>
              </Pressable>
              {reflectionFailure ? <Text style={styles.reflectionFailure}>{reflectionFailure}</Text> : null}
            </View>
            {reflection ? (
              <View style={styles.reflectionCard}>
                <Text style={styles.reflectionTitle}>本次回望</Text>
                <Text style={styles.reflectionSummary}>{reflection.summary}</Text>
                {reflection.observations.map((item) => (
                  <View key={`${item.text}-${item.source_entry_ids.join()}`} style={styles.reflectionItem}>
                    <Text style={styles.reflectionText}>{item.text}</Text>
                    <View style={styles.sources}>{item.source_entry_ids.map((id) => (
                      <Pressable key={id} onPress={() => router.push({ pathname: '/mood-journal/[id]', params: { id } })}>
                        <Text style={styles.sourceLink}>查看来源</Text>
                      </Pressable>
                    ))}</View>
                  </View>
                ))}
                {reflection.reflection_questions.map((question) => <Text key={question} style={styles.question}>想一想：{question}</Text>)}
                {reflection.gentle_suggestions.map((suggestion) => <Text key={suggestion.text} style={styles.suggestion}>可以试试：{suggestion.text}</Text>)}
                <Text style={styles.candidateNote}>这是一次性候选，不会自动写入日记或长期记忆。</Text>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </AppScreen>
  );
}

function currentWeekRange() {
  const now = new Date();
  const start = new Date(now);
  const offset = (now.getDay() + 6) % 7;
  start.setDate(now.getDate() - offset);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { from: localDateKey(start), to: localDateKey(end) };
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
  periodTabs: { alignSelf: 'center', flexDirection: 'row', padding: 3, borderRadius: radius.pill, backgroundColor: colors.surface },
  periodTab: { minWidth: 72, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  periodTabActive: { backgroundColor: colors.background },
  periodTabText: { color: colors.textSecondary, fontFamily, ...typography.label },
  periodTabTextActive: { color: colors.text },
  entryChoices: { marginTop: 14 },
  choiceRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  choiceCopy: { flex: 1 },
  choiceTitle: { color: colors.text, fontFamily, ...typography.body },
  choiceDate: { color: colors.textTertiary, fontFamily, ...typography.meta },
  excludedText: { marginTop: 8, color: colors.textTertiary, fontFamily, ...typography.meta },
  generateButton: { minHeight: 48, marginTop: 16, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: moodColors.accent },
  generateButtonDisabled: { opacity: 0.45 },
  generateButtonText: { color: colors.surface, fontFamily, ...typography.label },
  reflectionFailure: { marginTop: 10, color: colors.danger, fontFamily, ...typography.meta },
  reflectionCard: { marginTop: 20, padding: 16, borderRadius: radius.md, backgroundColor: moodColors.soft },
  reflectionTitle: { color: colors.text, fontFamily, ...typography.section },
  reflectionSummary: { marginTop: 8, color: colors.text, fontFamily, ...typography.body },
  reflectionItem: { marginTop: 14 },
  reflectionText: { color: colors.text, fontFamily, ...typography.body },
  sources: { marginTop: 4, flexDirection: 'row', gap: 12 },
  sourceLink: { color: moodColors.accentPressed, fontFamily, ...typography.meta, textDecorationLine: 'underline' },
  question: { marginTop: 12, color: colors.text, fontFamily, ...typography.body },
  suggestion: { marginTop: 8, color: colors.textSecondary, fontFamily, ...typography.body },
  candidateNote: { marginTop: 14, color: colors.textTertiary, fontFamily, ...typography.meta },
});
