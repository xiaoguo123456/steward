import {
  deleteMoodJournalEntry,
  errorMessage,
  updateMoodJournalEntry,
  useGetMoodJournalEntry,
  type NoteBlock,
  type UpdateMoodJournalEntryRequest,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { StatePanel } from '@/components/ui/state-panel';
import { MoodEditor, type MoodEditorValue } from '@/features/mood-journal/mood-editor';
import { entryMoodText } from '@/features/mood-journal/model';
import { useMoodJournalPolish } from '@/features/mood-journal/use-mood-journal-polish';
import { colors, fontFamily, moodColors, radius, typography } from '@/theme/tokens';

export default function MoodJournalDetailScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const polish = useMoodJournalPolish();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useGetMoodJournalEntry(id ?? '', { query: { enabled: Boolean(id) } });
  const entry = query.data?.data;
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const save = async (value: MoodEditorValue) => {
    if (!entry) return false;
    setSaving(true);
    setFailure(null);
    const clear: UpdateMoodJournalEntryRequest['clear'] = [];
    if (!value.title.trim()) clear.push('title');
    if (!value.moodLevel) clear.push('mood_level');
    if (!value.energyLevel) clear.push('energy_level');
    try {
      await updateMoodJournalEntry(entry.id, {
        clear,
        title: value.title.trim() || undefined,
        content: value.content,
        mood_level: value.moodLevel,
        energy_level: value.energyLevel,
        emotion_words: value.emotionWords,
        polish_action_id: value.polishActionId,
      }, { headers: { 'If-Match': String(entry.version) } });
      await queryClient.invalidateQueries();
      setEditing(false);
      return true;
    } catch (error) {
      setFailure(errorMessage(error, '修改没能保存，请重新加载后再试。'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    if (!entry) return;
    Alert.alert('删除这篇日记？', '删除后无法恢复。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => void deleteMoodJournalEntry(entry.id)
          .then(() => queryClient.invalidateQueries())
          .then(() => router.back())
          .catch((error) => setFailure(errorMessage(error, '删除没有完成。'))),
      },
    ]);
  };

  if (query.isPending) {
    return <AppScreen><NavHeader /><View style={styles.loading}><ActivityIndicator color={moodColors.accent} /></View></AppScreen>;
  }

  if (query.isError || !entry) {
    return (
      <AppScreen>
        <NavHeader />
        <View style={styles.stateWrap}>
          <StatePanel
            actionLabel="返回"
            icon="alert-circle-outline"
            message={errorMessage(query.error, '这篇日记可能已经被删除。')}
            onAction={() => router.back()}
            title="打不开这篇日记"
          />
        </View>
      </AppScreen>
    );
  }

  if (editing) {
    return (
      <MoodEditor
        failure={failure}
        initial={{
          title: entry.title,
          content: entry.content,
          moodLevel: entry.mood_level,
          energyLevel: entry.energy_level,
          emotionWords: entry.emotion_words,
        }}
        occurredAt={new Date(entry.occurred_at)}
        onPolish={polish}
        onSubmit={save}
        saving={saving}
        submitLabel="保存"
      />
    );
  }

  const moodText = entryMoodText(entry);
  return (
    <AppScreen>
      <NavHeader
        right={(
          <View style={styles.headerActions}>
            <Pressable accessibilityLabel="编辑日记" accessibilityRole="button" hitSlop={10} onPress={() => setEditing(true)}>
              <AppIcon color={colors.text} name="create-outline" size={21} />
            </Pressable>
            <Pressable accessibilityLabel="删除日记" accessibilityRole="button" hitSlop={10} onPress={remove}>
              <AppIcon color={colors.danger} name="trash-outline" size={21} />
            </Pressable>
          </View>
        )}
        title={formatEntryDate(new Date(entry.occurred_at))}
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {entry.title ? <Text style={styles.title}>{entry.title}</Text> : null}
        {moodText ? (
          <View style={styles.moodMeta}>
            <View style={styles.moodDot} />
            <Text style={styles.moodText}>{moodText}</Text>
          </View>
        ) : null}
        <View style={styles.document}>
          {entry.content.blocks.map((block) => <ReadOnlyBlock block={block} key={block.id} />)}
        </View>
        <View style={styles.privateNote}>
          <AppIcon color={colors.textTertiary} name="lock-closed-outline" size={15} />
          <Text style={styles.privateText}>仅你可见</Text>
        </View>
        {failure ? <Text style={styles.failure}>{failure}</Text> : null}
      </ScrollView>
    </AppScreen>
  );
}

function ReadOnlyBlock({ block }: { block: NoteBlock }) {
  const text = block.runs.map((run) => run.text).join('');
  if (!text) return null;
  const mark = block.runs[0]?.marks;
  return (
    <View style={[styles.blockRow, block.type === 'quote' && styles.quoteRow]}>
      {block.type === 'bullet_item' ? <Text style={styles.prefix}>•</Text> : null}
      {block.type === 'ordered_item' ? <Text style={styles.prefix}>1.</Text> : null}
      <Text style={[
        styles.paragraph,
        block.type === 'heading_2' && styles.heading2,
        block.type === 'heading_3' && styles.heading3,
        block.type === 'quote' && styles.quote,
        mark?.bold && styles.bold,
        mark?.italic && styles.italic,
        mark?.strikethrough && styles.strike,
      ]}>{text}</Text>
    </View>
  );
}

function formatEntryDate(date: Date) {
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stateWrap: { paddingHorizontal: 16 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 48 },
  title: { color: colors.text, fontFamily, ...typography.detail },
  moodMeta: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 7 },
  moodDot: { width: 9, height: 9, borderRadius: radius.pill, backgroundColor: moodColors.accent },
  moodText: { color: moodColors.text, fontFamily, ...typography.meta },
  document: { marginTop: 22 },
  blockRow: { flexDirection: 'row', alignItems: 'flex-start' },
  prefix: { width: 24, color: colors.text, fontFamily, fontSize: 17, lineHeight: 28 },
  paragraph: { flex: 1, marginBottom: 12, color: colors.text, fontFamily, fontSize: 17, lineHeight: 28 },
  heading2: { marginTop: 9, fontSize: 21, lineHeight: 31, fontWeight: '700' },
  heading3: { marginTop: 7, fontSize: 18, lineHeight: 28, fontWeight: '600' },
  quoteRow: { marginVertical: 7, paddingLeft: 12, borderLeftWidth: 3, borderLeftColor: moodColors.atmosphere },
  quote: { color: colors.textSecondary },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  privateNote: { marginTop: 22, flexDirection: 'row', alignItems: 'center', gap: 6 },
  privateText: { color: colors.textTertiary, fontFamily, ...typography.meta },
  failure: { marginTop: 16, color: colors.danger, fontFamily, ...typography.meta },
});
