import { deleteNote, errorMessage, updateNote, useGetNote } from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { StatePanel } from '@/components/ui/state-panel';
import { NoteEditor, type NoteDraft } from '@/features/notes/note-editor';
import { formatRelativeTime } from '@/utils/format';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

export default function NoteDetailScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const noteQuery = useGetNote(id ?? '', { query: { enabled: Boolean(id) } });
  const note = noteQuery.data?.data;

  const save = async (draft: NoteDraft) => {
    if (!note) return;
    setSaving(true);
    setError(null);
    try {
      // 带上 version：别处改过之后再保存会被服务端挡住，
      // 而不是把对方的修改静默覆盖掉。
      await updateNote(
        note.id,
        {
          title: draft.title || undefined,
          content: { format: 'plain_text', text: draft.content },
          tags: draft.tags,
        },
        { headers: { 'If-Match': String(note.version) } },
      );
      await queryClient.invalidateQueries();
      setEditing(false);
    } catch (err) {
      setError(errorMessage(err, '修改没能保存。'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!note) return;
    setError(null);
    try {
      await deleteNote(note.id);
      await queryClient.invalidateQueries();
      router.back();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (noteQuery.isPending) {
    return (
      <AppScreen>
        <NavHeader />
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </AppScreen>
    );
  }

  if (noteQuery.isError || !note) {
    return (
      <AppScreen>
        <NavHeader />
        <View style={styles.content}>
          <StatePanel
            actionLabel="返回"
            icon="alert-circle-outline"
            message={errorMessage(noteQuery.error, '这篇笔记可能已被删除。')}
            onAction={() => router.back()}
            title="打不开这篇笔记"
          />
        </View>
      </AppScreen>
    );
  }

  if (editing) {
    return (
      <AppScreen includeBottomInset>
        <NavHeader
          onBack={() => {
            setError(null);
            setEditing(false);
          }}
          title="编辑笔记"
        />
        <NoteEditor
          failure={error}
          initial={{ title: note.title, content: note.content_plaintext, tags: note.tags }}
          onSubmit={(draft) => void save(draft)}
          saving={saving}
          submitLabel="保存修改"
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen>
      <NavHeader
        right={
          <View style={styles.headerActions}>
            <Pressable
              accessibilityLabel="编辑笔记"
              accessibilityRole="button"
              hitSlop={12}
              onPress={() => setEditing(true)}
            >
              <AppIcon color={colors.text} name="create-outline" size={21} />
            </Pressable>
            <Pressable
              accessibilityLabel="删除笔记"
              accessibilityRole="button"
              hitSlop={12}
              onPress={() => void remove()}
            >
              <AppIcon color={colors.danger} name="trash-outline" size={21} />
            </Pressable>
          </View>
        }
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>{note.title}</Text>
        <View style={styles.meta}>
          <Text style={styles.time}>{formatRelativeTime(note.updated_at)}</Text>
          {note.tags.map((tag) => (
            <View key={tag} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.paragraph}>{note.content_plaintext}</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {note.created_by !== 'user' ? (
          <View style={styles.provenance}>
            <AppIcon color={colors.primaryStrong} name="sparkles-outline" size={16} />
            <Text style={styles.provenanceText}>
              这篇笔记由 AI 从一次输入整理生成，并经过你的确认。
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    marginTop: 4,
    color: colors.text,
    fontFamily,
    ...typography.detail,
  },
  meta: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  time: {
    color: colors.textTertiary,
    fontFamily,
    ...typography.meta,
  },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  tagText: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 12,
    fontWeight: '500',
  },
  paragraph: {
    marginTop: 18,
    color: colors.text,
    fontFamily,
    ...typography.body,
    lineHeight: 26,
  },
  error: {
    marginTop: 16,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  provenance: {
    marginTop: 24,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  provenanceText: {
    flex: 1,
    color: colors.primaryStrong,
    fontFamily,
    ...typography.meta,
  },
});
