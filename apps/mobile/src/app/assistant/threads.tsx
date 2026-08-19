import { errorMessage, useDeleteThread, useListThreads } from '@steward/api-client';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';
import { formatRelativeTime } from '@/utils/format';

/**
 * 历史对话列表。
 *
 * 只有真正说过话的对话会出现在这里：打开面板又直接关掉不算一次对话。
 * 标题取自首条用户消息，所以这一页能扫着看。
 */
export default function ThreadsScreen() {
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);
  const threads = useListThreads({ limit: 50 });

  const remove = useDeleteThread({
    mutation: {
      onSuccess: () => {
        setFailure(null);
        void threads.refetch();
      },
      onError: (error) => setFailure(errorMessage(error, '删除没有成功。')),
    },
  });

  const items = threads.data?.data ?? [];

  return (
    <AppScreen includeBottomInset>
      <NavHeader title="历史对话" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {failure ? <Text style={styles.failure}>{failure}</Text> : null}

        {threads.isLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.loading} />
        ) : null}

        {!threads.isLoading && items.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>还没有对话记录</Text>
            <Text style={styles.emptyCopy}>
              和 AI 管家说过话之后，每一次对话会出现在这里。
            </Text>
          </View>
        ) : null}

        {items.map((thread) => (
          <View key={thread.id} style={styles.row}>
            <Pressable
              accessibilityLabel={`打开对话：${thread.title}`}
              accessibilityRole="button"
              onPress={() =>
                router.push({ pathname: '/ai', params: { threadId: thread.id } })
              }
              style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}
            >
              <Text numberOfLines={1} style={styles.title}>{thread.title}</Text>
              <Text style={styles.meta}>{formatRelativeTime(thread.updated_at)}</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={`删除对话：${thread.title}`}
              accessibilityRole="button"
              disabled={remove.isPending}
              onPress={() => {
                setFailure(null);
                remove.mutate({ threadId: thread.id });
              }}
              style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}
            >
              <AppIcon color={colors.textTertiary} name="trash-outline" size={18} />
            </Pressable>
          </View>
        ))}

        {items.length > 0 ? (
          <Text style={styles.note}>
            删除对话只清理消息记录。已经执行过的任务、日程等内容不受影响。
          </Text>
        ) : null}
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 40,
  },
  failure: {
    marginBottom: 10,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  loading: {
    marginTop: 24,
  },
  emptyCard: {
    padding: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
    gap: 7,
  },
  emptyTitle: {
    color: colors.text,
    fontFamily,
    ...typography.body,
    fontWeight: '600',
  },
  emptyCopy: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowMain: {
    flex: 1,
    minHeight: 60,
    justifyContent: 'center',
    gap: 3,
  },
  title: {
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  meta: {
    color: colors.textTertiary,
    fontFamily,
    ...typography.meta,
  },
  deleteButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: {
    marginTop: 18,
    color: colors.textTertiary,
    fontFamily,
    ...typography.meta,
  },
  pressed: {
    opacity: 0.7,
  },
});
