import {
  errorMessage,
  useDeleteMemory,
  useDeleteRelearnBlock,
  useListMemories,
  useListRelearnBlocks,
  type MemoryItem,
} from '@steward/api-client';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

/**
 * 长期记忆管理页。
 *
 * 这一页要回答三个问题：系统记住了什么、从哪里来、我怎么让它忘掉。
 * 每条记忆都带来源，没有来源的条目在服务端就不会存在。
 */
export default function MemoriesScreen() {
  const [failure, setFailure] = useState<string | null>(null);
  const memories = useListMemories({ limit: 50 });
  const blocks = useListRelearnBlocks();

  const remove = useDeleteMemory({
    mutation: {
      onSuccess: () => {
        setFailure(null);
        void memories.refetch();
        void blocks.refetch();
      },
      onError: (error) => setFailure(errorMessage(error, '删除没有成功。')),
    },
  });
  const unblock = useDeleteRelearnBlock({
    mutation: {
      onSuccess: () => {
        setFailure(null);
        void blocks.refetch();
      },
      onError: (error) => setFailure(errorMessage(error, '解除没有成功。')),
    },
  });

  const items = memories.data?.data ?? [];
  const blocked = blocks.data?.data ?? [];

  return (
    <AppScreen includeBottomInset>
      <NavHeader title="系统记住的偏好" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>
          这些是你确认过、系统会长期参考的偏好。每一条都能看到它从哪来。
          删除后立刻不再使用；如果不想再被学到，删除时选「不再学这项」。
        </Text>

        {failure ? <Text style={styles.failure}>{failure}</Text> : null}

        {memories.isLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.loading} />
        ) : null}

        {!memories.isLoading && items.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>还没有记住任何偏好</Text>
            <Text style={styles.emptyCopy}>
              助理只有在你明确确认之后才会记住一件事，不会自己从行为里推断。
            </Text>
          </View>
        ) : null}

        {items.map((item) => (
          <MemoryRow
            busy={remove.isPending && remove.variables?.memoryId === item.id}
            item={item}
            key={item.id}
            onDelete={(block) => {
              setFailure(null);
              remove.mutate({ memoryId: item.id, data: { block_relearning: block } });
            }}
          />
        ))}

        {blocked.length > 0 ? (
          <>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              已禁止重新学习
            </Text>
            <Text style={styles.sectionCopy}>
              这里只显示语义键。被阻止的具体内容没有留存，也无法恢复。
            </Text>
            {blocked.map((block) => (
              <View key={block.id} style={styles.blockRow}>
                <Text style={styles.blockKey}>{block.memory_key}</Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={unblock.isPending}
                  onPress={() => {
                    setFailure(null);
                    unblock.mutate({ blockId: block.id });
                  }}
                  style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}
                >
                  <Text style={styles.linkText}>允许再次学习</Text>
                </Pressable>
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
    </AppScreen>
  );
}

function MemoryRow({
  item,
  busy,
  onDelete,
}: {
  item: MemoryItem;
  busy: boolean;
  onDelete: (blockRelearning: boolean) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <View style={styles.card}>
      <Text style={styles.memoryText}>{item.canonical_text}</Text>

      <View style={styles.metaRow}>
        <Text style={styles.metaChip}>{typeLabel(item.memory_type)}</Text>
        {item.sensitivity !== 'normal' ? (
          <Text style={[styles.metaChip, styles.sensitiveChip]}>敏感信息</Text>
        ) : null}
        <Text style={styles.metaText}>{originLabel(item.origin)}</Text>
      </View>

      {item.evidence?.length ? (
        <Text style={styles.evidence}>
          来源：{item.evidence.map((e) => evidenceLabel(e.source_type)).join('、')}
        </Text>
      ) : null}

      {confirming ? (
        <View style={styles.confirmBox}>
          <Text style={styles.confirmCopy}>删除后还要禁止以后再学到同样的偏好吗？</Text>
          <View style={styles.confirmActions}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => setConfirming(false)}
              style={({ pressed }) => [styles.ghostButton, pressed && styles.pressed]}
            >
              <Text style={styles.ghostText}>取消</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => onDelete(false)}
              style={({ pressed }) => [styles.ghostButton, pressed && styles.pressed]}
            >
              <Text style={styles.ghostText}>只删除</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => onDelete(true)}
              style={({ pressed }) => [styles.dangerButton, pressed && styles.pressed]}
            >
              {busy ? (
                <ActivityIndicator color={colors.background} size="small" />
              ) : (
                <Text style={styles.dangerText}>删除并不再学</Text>
              )}
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => setConfirming(true)}
          style={({ pressed }) => [styles.deleteRow, pressed && styles.pressed]}
        >
          <AppIcon color={colors.danger} name="trash-outline" size={16} />
          <Text style={styles.deleteText}>忘掉这条</Text>
        </Pressable>
      )}
    </View>
  );
}

function typeLabel(type: MemoryItem['memory_type']) {
  switch (type) {
    case 'communication_preference':
      return '沟通偏好';
    case 'routine_preference':
      return '作息习惯';
    case 'domain_preference':
      return '场景偏好';
    case 'personal_context':
      return '个人情况';
    case 'constraint':
      return '限制条件';
    default:
      return '偏好';
  }
}

function originLabel(origin: MemoryItem['origin']) {
  switch (origin) {
    case 'explicit':
      return '你直接设置的';
    case 'learned':
      return '从对话中学到并经你确认';
    default:
      return '导入的';
  }
}

function evidenceLabel(sourceType: string) {
  switch (sourceType) {
    case 'user_message':
      return '你说过的话';
    case 'assistant_message':
      return '助理的回复';
    case 'object':
      return '你的内容';
    case 'record':
      return '你的记录';
    case 'user_setting':
      return '你在设置里的修改';
    default:
      return sourceType;
  }
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 40,
    gap: 12,
  },
  intro: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  failure: {
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
  card: {
    padding: 14,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
    gap: 9,
  },
  memoryText: {
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 7,
  },
  metaChip: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  sensitiveChip: {
    backgroundColor: colors.primarySoft,
    color: colors.primaryStrong,
  },
  metaText: {
    color: colors.textTertiary,
    fontFamily,
    ...typography.meta,
  },
  evidence: {
    color: colors.textTertiary,
    fontFamily,
    ...typography.meta,
  },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    minHeight: 40,
  },
  deleteText: {
    color: colors.danger,
    fontFamily,
    ...typography.meta,
    fontWeight: '600',
  },
  confirmBox: {
    gap: 10,
  },
  confirmCopy: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  confirmActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  ghostButton: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  ghostText: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  dangerButton: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
  },
  dangerText: {
    color: colors.background,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  sectionTitle: {
    marginTop: 18,
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  sectionCopy: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  blockRow: {
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  blockKey: {
    flex: 1,
    color: colors.text,
    fontFamily,
    ...typography.meta,
  },
  linkButton: {
    minHeight: 40,
    justifyContent: 'center',
  },
  linkText: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.meta,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.8,
  },
});
