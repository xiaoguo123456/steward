import { errorMessage, useListNotes, type Note } from '@steward/api-client';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { stageAssistantDraft } from '@/features/assistant/assistant-draft-store';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';
import { formatRelativeTime } from '@/utils/format';
import { selectDailyPrompts, type InspirationPrompt } from './inspiration-prompts';
import { selectDailyInspirationNote } from './inspiration-selection';

export function InspirationContent({ active }: { active: boolean }) {
  const router = useRouter();
  const localDate = formatLocalDate(new Date());
  const notesQuery = useListNotes(
    { limit: 50 },
    { query: { enabled: active } },
  );
  const selectedNote = useMemo(
    () => selectDailyInspirationNote(notesQuery.data?.data ?? [], localDate),
    [localDate, notesQuery.data?.data],
  );
  const dailyPrompts = useMemo(() => selectDailyPrompts(localDate), [localDate]);
  const leadPrompt = dailyPrompts[0];
  const otherPrompts = dailyPrompts.slice(1);

  const openPrompt = (prompt: InspirationPrompt) => {
    stageAssistantDraft({
      text: '',
      contextLabel: prompt.theme,
      surface: 'inspiration',
      openingPrompt: prompt.question,
      firstTurnContext: [
        `我在回答这个问题：“${prompt.question}”。`,
        '请先理解我的回答，再一次只追问一个最有帮助的问题；不要急着替我下结论或直接创建内容。',
      ].join('\n'),
    });
    router.push('/ai');
  };

  const continueThinking = (note: Note) => {
    stageAssistantDraft({
      text: '',
      contextLabel: `来自《${note.title}》`,
      surface: 'inspiration',
      openingPrompt: `重新读到《${note.title}》，现在最想继续想哪一部分？`,
      firstTurnContext: [
        `请基于我的笔记《${note.title}》继续讨论。`,
        '先检索这篇笔记并引用有效来源，再根据我的回复一次只追问一个问题；不要直接创建或修改内容。',
      ].join('\n'),
    });
    router.push('/ai');
  };

  return (
    <View style={styles.content}>
      <Text accessibilityRole="header" style={styles.title}>今天的灵感</Text>

      {leadPrompt ? (
        <View style={styles.lead}>
          <Text style={styles.theme}>{leadPrompt.theme}</Text>
          <Text style={styles.leadQuestion}>{leadPrompt.question}</Text>
          <AppButton
            accessibilityLabel={`开始聊聊：${leadPrompt.question}`}
            compact
            label="开始聊聊"
            onPress={() => openPrompt(leadPrompt)}
            style={styles.textButton}
            variant="text"
          />
        </View>
      ) : null}

      {otherPrompts.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>换个话题</Text>
          <View style={styles.promptList}>
            {otherPrompts.map((prompt) => (
              <Pressable
                accessibilityLabel={`聊聊：${prompt.question}`}
                accessibilityRole="button"
                key={prompt.id}
                onPress={() => openPrompt(prompt)}
                style={({ pressed }) => [styles.promptRow, pressed && styles.rowPressed]}
              >
                <Text style={styles.promptTheme}>{prompt.theme}</Text>
                <Text style={styles.promptQuestion}>{prompt.question}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {notesQuery.isPending ? (
        <InspirationNoteSkeleton />
      ) : notesQuery.isError ? (
        <View style={styles.sourceError}>
          <Text numberOfLines={2} style={styles.sourceErrorText}>
            {errorMessage(notesQuery.error, '笔记暂时没有加载出来。')}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void notesQuery.refetch()}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
          >
            <Text style={styles.retryLabel}>重试</Text>
          </Pressable>
        </View>
      ) : selectedNote ? (
        <View style={styles.section}>
          <View style={styles.sourceHeading}>
            <Text style={styles.sectionTitle}>重新遇见</Text>
            <Text style={styles.sourceAge}>{formatRelativeTime(selectedNote.updated_at)}</Text>
          </View>
          <View style={styles.noteBody}>
            <Text style={styles.noteTitle}>{selectedNote.title}</Text>
            <Text numberOfLines={4} style={styles.noteText}>{selectedNote.content_plaintext}</Text>
            <View style={styles.noteActions}>
              <AppButton
                compact
                label="打开原文"
                onPress={() => router.push({
                  pathname: '/notes/[id]',
                  params: { id: selectedNote.id },
                })}
                style={styles.textButton}
                variant="textMuted"
              />
              <AppButton
                compact
                label="继续想想"
                onPress={() => continueThinking(selectedNote)}
                style={styles.textButton}
                variant="text"
              />
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function InspirationNoteSkeleton() {
  return (
    <View accessibilityLabel="正在加载旧笔记" style={styles.section}>
      <View style={styles.skeletonHeading} />
      <View style={styles.skeletonTitle} />
      <View style={styles.skeletonLine} />
      <View style={[styles.skeletonLine, styles.skeletonLineShort]} />
    </View>
  );
}

function formatLocalDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

const styles = StyleSheet.create({
  content: {
    paddingTop: 26,
    paddingBottom: 24,
  },
  title: {
    color: colors.text,
    fontFamily,
    fontSize: 22,
    lineHeight: 31,
    fontWeight: '600',
  },
  lead: {
    paddingTop: 28,
    paddingBottom: 20,
  },
  theme: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    fontWeight: '600',
  },
  leadQuestion: {
    maxWidth: 560,
    marginTop: 8,
    color: colors.text,
    fontFamily,
    fontSize: 21,
    lineHeight: 32,
    fontWeight: '500',
    letterSpacing: -0.2,
  },
  textButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 0,
  },
  section: {
    marginTop: 22,
  },
  sectionTitle: {
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  promptList: {
    marginTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  promptRow: {
    minHeight: 76,
    paddingVertical: 13,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  promptTheme: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    fontWeight: '600',
  },
  promptQuestion: {
    marginTop: 3,
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  rowPressed: {
    backgroundColor: colors.surfaceSubtle,
  },
  sourceHeading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  sourceAge: {
    color: colors.textTertiary,
    fontFamily,
    ...typography.meta,
  },
  noteBody: {
    marginTop: 10,
    paddingTop: 15,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  noteTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 17,
    lineHeight: 25,
    fontWeight: '600',
  },
  noteText: {
    marginTop: 6,
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
  },
  noteActions: {
    marginTop: 5,
    flexDirection: 'row',
    gap: 22,
  },
  sourceError: {
    minHeight: 58,
    marginTop: 22,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  sourceErrorText: {
    flex: 1,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  retryButton: {
    minWidth: 52,
    minHeight: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  retryLabel: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  skeletonHeading: {
    width: 88,
    height: 16,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  skeletonTitle: {
    width: '58%',
    height: 19,
    marginTop: 20,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  skeletonLine: {
    width: '92%',
    height: 13,
    marginTop: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  skeletonLineShort: {
    width: '68%',
    marginTop: 7,
  },
  pressed: {
    opacity: 0.58,
  },
});
