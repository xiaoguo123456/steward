import { deleteNote, errorMessage, useGetNote } from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { StatePanel } from '@/components/ui/state-panel';
import { formatRelativeTime } from '@/utils/format';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

export default function NoteDetailScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [error, setError] = useState<string | null>(null);

  const noteQuery = useGetNote(id ?? '', { query: { enabled: Boolean(id) } });
  const note = noteQuery.data?.data;

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

  return (
    <AppScreen>
      <NavHeader
        right={
          <Pressable
            accessibilityLabel="删除笔记"
            accessibilityRole="button"
            hitSlop={12}
            onPress={() => void remove()}
          >
            <AppIcon color={colors.danger} name="trash-outline" size={21} />
          </Pressable>
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

        <Text style={styles.paragraph}>{note.content}</Text>

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
