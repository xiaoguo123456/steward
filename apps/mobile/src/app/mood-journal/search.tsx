import { errorMessage, useListMoodJournalEntries, type MoodJournalEntry } from '@steward/api-client';
import { useRouter } from 'expo-router';
import { useDeferredValue, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { StatePanel } from '@/components/ui/state-panel';
import { entryMoodText } from '@/features/mood-journal/model';
import { colors, fontFamily, moodColors, radius, typography } from '@/theme/tokens';

export default function MoodJournalSearchScreen() {
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query.trim());
  const result = useListMoodJournalEntries({ q: deferred, limit: 50 }, { query: { enabled: deferred.length > 0 } });
  const entries = result.data?.data ?? [];

  return (
    <AppScreen>
      <NavHeader title="搜索日记" />
      <View style={styles.searchWrap}>
        <View style={styles.searchField}>
          <AppIcon color={colors.textSecondary} name="search-outline" size={19} />
          <TextInput
            accessibilityLabel="搜索日记正文和标题"
            autoFocus
            onChangeText={setQuery}
            placeholder="搜索标题或正文"
            placeholderTextColor={colors.textSecondary}
            returnKeyType="search"
            style={styles.input}
            value={query}
          />
          {query ? (
            <Pressable accessibilityLabel="清空搜索" accessibilityRole="button" hitSlop={10} onPress={() => setQuery('')}>
              <AppIcon color={colors.textSecondary} name="close-circle" size={18} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.results} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {!deferred ? (
          <View style={styles.hint}>
            <Text style={styles.hintTitle}>找回一个片段</Text>
            <Text style={styles.hintText}>输入人物、地点、感受或正文中的一句话。</Text>
          </View>
        ) : result.isPending ? (
          <View style={styles.loading}><ActivityIndicator color={moodColors.accent} /></View>
        ) : result.isError ? (
          <StatePanel
            actionLabel="重试"
            compact
            icon="cloud-offline-outline"
            message={errorMessage(result.error, '搜索暂时没有完成。')}
            onAction={() => void result.refetch()}
            title="没有搜索出来"
          />
        ) : entries.length === 0 ? (
          <View style={styles.hint}>
            <Text style={styles.hintTitle}>没有找到相关日记</Text>
            <Text style={styles.hintText}>换一个更短的关键词试试。</Text>
          </View>
        ) : entries.map((entry, index) => <SearchResult entry={entry} key={entry.id} showDivider={index > 0} />)}
      </ScrollView>
    </AppScreen>
  );
}

function SearchResult({ entry, showDivider }: { entry: MoodJournalEntry; showDivider: boolean }) {
  const router = useRouter();
  const date = new Date(entry.occurred_at);
  const mood = entryMoodText(entry);
  return (
    <Pressable
      accessibilityLabel={entry.content_plaintext}
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/mood-journal/[id]', params: { id: entry.id } })}
      style={({ pressed }) => [styles.result, showDivider && styles.divider, pressed && styles.pressed]}
    >
      <View style={styles.resultCopy}>
        <Text style={styles.resultMeta}>{date.getMonth() + 1}月{date.getDate()}日{mood ? ` · ${mood}` : ''}</Text>
        {entry.title ? <Text numberOfLines={1} style={styles.resultTitle}>{entry.title}</Text> : null}
        <Text numberOfLines={3} style={styles.resultText}>{entry.content_plaintext}</Text>
      </View>
      <AppIcon color={colors.textTertiary} name="chevron-forward" size={17} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: 16, paddingVertical: 10 },
  searchField: { minHeight: 48, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: radius.md, backgroundColor: colors.surfaceSubtle },
  input: { flex: 1, minHeight: 48, paddingVertical: 0, color: colors.text, fontFamily, ...typography.input },
  results: { paddingHorizontal: 16, paddingBottom: 48 },
  loading: { paddingVertical: 64, alignItems: 'center' },
  hint: { paddingTop: 56, alignItems: 'center' },
  hintTitle: { color: colors.text, fontFamily, ...typography.section },
  hintText: { marginTop: 6, color: colors.textSecondary, fontFamily, ...typography.meta, textAlign: 'center' },
  result: { minHeight: 118, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  resultCopy: { flex: 1 },
  resultMeta: { color: moodColors.text, fontFamily, ...typography.meta },
  resultTitle: { marginTop: 4, color: colors.text, fontFamily, ...typography.bodyStrong },
  resultText: { marginTop: 4, color: colors.text, fontFamily, ...typography.body },
  pressed: { opacity: 0.56 },
});
