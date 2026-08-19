import {
  errorMessage,
  useCreateThread,
  useCreateTurn,
  useGetOperation,
  useListMessages,
  useListProposals,
  type ActionProposal,
  type AssistantMessage,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AiAssistantAvatar } from '@/components/ui/ai-assistant-avatar';
import { AppIcon } from '@/components/ui/icon';
import { ModalSheet } from '@/components/ui/modal-sheet';
import { ProposalCard } from '@/features/assistant/proposal-card';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

/**
 * AI 管家对话面板。
 *
 * 权威会话在服务端：这里不做任何本地推断，也不缓存"看起来该有的"回复。
 * 发送消息返回 202 与 operation_id，回复在 Worker 里生成，
 * 这里轮询 Operation，完成后重新拉消息列表。
 *
 * 助理不能直接改任何数据。它要改东西时会给出一条待确认建议，
 * 由 ProposalCard 呈现，用户点确认后服务端才执行。
 */
export default function AiConversationScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const listRef = useRef<ScrollView>(null);

  const [threadId, setThreadId] = useState('');
  const [operationId, setOperationId] = useState('');
  const [input, setInput] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const createThread = useCreateThread({
    mutation: {
      onSuccess: (result) => setThreadId(result.data.id),
      onError: (error) => setFailure(errorMessage(error, '没能打开对话，请稍后再试。')),
    },
  });

  // 每次打开面板都开一个新对话：这一版还没有历史会话入口，
  // 沿用上次的上下文只会让用户困惑于助理"记得"一些他看不到的东西。
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    createThread.mutate({ data: {} });
    // 只在面板打开时建一次对话，mutation 对象每次渲染都是新引用，不放进依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const messages = useListMessages(
    threadId,
    { limit: 50 },
    { query: { enabled: Boolean(threadId) } },
  );

  const proposals = useListProposals(
    { status: ['pending'] },
    { query: { enabled: Boolean(threadId) } },
  );

  const operation = useGetOperation(operationId, {
    query: {
      enabled: Boolean(operationId),
      refetchInterval: (query) => {
        const status = query.state.data?.data.status;
        return status === 'succeeded' || status === 'failed' || status === 'cancelled'
          ? false
          : 900;
      },
    },
  });

  const turnStatus = operation.data?.data.status;
  const settled =
    turnStatus === 'succeeded' || turnStatus === 'failed' || turnStatus === 'cancelled';
  // 状态还没拉回来时也算"正在回复"，否则用户能在同一轮里连发两条。
  const thinking = Boolean(operationId) && !settled;

  // 这一轮结束就把消息与建议拉一次。
  // 不清空 operationId：那是渲染期的 setState，而且 Operation 完成后
  // 轮询本来就会自己停下来。
  useEffect(() => {
    if (!operationId || !settled) return;
    void messages.refetch();
    void proposals.refetch();
    // messages 与 proposals 是查询对象，每次渲染都是新引用，不放进依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operationId, settled]);

  // 回复失败的说明由服务端给，直接派生出来展示，不额外存一份状态。
  const turnFailure =
    turnStatus === 'failed'
      ? errorMessage(operation.data?.data.error, '助理这次没能回复，请稍后再试。')
      : null;

  const createTurn = useCreateTurn({
    mutation: {
      onSuccess: (result) => {
        setOperationId(result.data.operation_id);
        void messages.refetch();
      },
      onError: (error) => setFailure(errorMessage(error, '消息没能发出去。')),
    },
  });

  const send = () => {
    const text = input.trim();
    if (!text || !threadId || thinking) return;
    setFailure(null);
    setInput('');
    createTurn.mutate({ threadId, data: { text } });
  };

  const scrollToLatest = () => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  };

  // 契约按 message_seq 倒序返回，展示要按时间正序。
  const ordered = [...(messages.data?.data ?? [])].reverse();
  const pending = proposals.data?.data ?? [];
  const canSend = Boolean(input.trim()) && Boolean(threadId) && !thinking;

  return (
    <ModalSheet maxHeight="84%" onClose={() => router.back()}>
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <AiAssistantAvatar size={36} />
        </View>
        <View style={styles.headerCopy}>
          <Text accessibilityRole="header" style={styles.headerTitle}>AI 管家</Text>
          <Text style={styles.headerStatus}>
            {thinking ? '正在查你的数据…' : '问我今天要做什么，或者让我帮你安排'}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="关闭 AI 管家"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.closeButton, pressed && styles.iconPressed]}
        >
          <AppIcon name="close" size={23} />
        </Pressable>
      </View>

      <ScrollView
        ref={listRef}
        accessibilityLabel="与 AI 管家的对话"
        accessibilityLiveRegion="polite"
        contentContainerStyle={styles.messages}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={scrollToLatest}
        showsVerticalScrollIndicator={false}
      >
        {ordered.length === 0 && !messages.isLoading ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>我能帮你看你自己的内容</Text>
            <Text style={styles.emptyCopy}>
              比如「这周有什么要做的」「这个月在吃饭上花了多少」。
              需要改动时我会先给你一条建议，你确认了我才动。
            </Text>
          </View>
        ) : null}

        {ordered.map((message) => (
          <MessageRow
            key={message.id}
            message={message}
            proposals={pending.filter((p) => message.proposal_ids?.includes(p.id))}
            onProposalResolved={() => {
              void proposals.refetch();
              // 建议执行后会改到任务、日程等正式内容，缓存必须整体失效。
              void queryClient.invalidateQueries();
            }}
          />
        ))}

        {thinking ? (
          <View style={styles.thinkingRow}>
            <View style={styles.assistantMark}>
              <AiAssistantAvatar size={30} />
            </View>
            <View style={[styles.bubble, styles.assistantBubble, styles.thinkingBubble]}>
              <ActivityIndicator color={colors.textSecondary} size="small" />
              <Text style={styles.thinkingText}>正在查…</Text>
            </View>
          </View>
        ) : null}

        {failure ?? turnFailure ? (
          <Text style={styles.failure}>{failure ?? turnFailure}</Text>
        ) : null}
      </ScrollView>

      <View style={styles.composerWrap}>
        <View style={styles.composer}>
          <TextInput
            accessibilityLabel="输入给 AI 管家的消息"
            editable={Boolean(threadId)}
            multiline
            onChangeText={setInput}
            placeholder={thinking ? '正在回复…' : '说点什么…'}
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
            value={input}
          />
          <Pressable
            accessibilityLabel="发送消息"
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={send}
            style={({ pressed }) => [
              styles.sendButton,
              !canSend && styles.sendDisabled,
              pressed && canSend && styles.sendPressed,
            ]}
          >
            <AppIcon
              color={canSend ? colors.background : colors.textSecondary}
              name="arrow-up"
              size={19}
            />
          </Pressable>
        </View>
      </View>
    </ModalSheet>
  );
}

function MessageRow({
  message,
  proposals,
  onProposalResolved,
}: {
  message: AssistantMessage;
  proposals: ActionProposal[];
  onProposalResolved: () => void;
}) {
  const isUser = message.role === 'user';

  return (
    <View style={styles.messageGroup}>
      <View style={[styles.messageRow, isUser && styles.userRow]}>
        {isUser ? null : (
          <View style={styles.assistantMark}>
            <AiAssistantAvatar size={30} />
          </View>
        )}
        <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
          <Text style={[styles.messageText, isUser && styles.userText]}>{message.content}</Text>
        </View>
      </View>

      {proposals.map((proposal) => (
        <ProposalCard key={proposal.id} onResolved={onProposalResolved} proposal={proposal} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 66,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerIcon: {
    width: 38,
    height: 38,
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: {
    flex: 1,
  },
  headerTitle: {
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  headerStatus: {
    marginTop: 1,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPressed: {
    backgroundColor: colors.surface,
  },
  messages: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 22,
    gap: 16,
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
  messageGroup: {
    gap: 12,
  },
  messageRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  userRow: {
    justifyContent: 'flex-end',
  },
  assistantMark: {
    width: 30,
    height: 30,
    marginTop: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubble: {
    maxWidth: '84%',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.lg,
  },
  assistantBubble: {
    borderTopLeftRadius: 7,
    backgroundColor: colors.surfaceSubtle,
  },
  userBubble: {
    borderTopRightRadius: 7,
    backgroundColor: colors.primary,
  },
  messageText: {
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  userText: {
    color: colors.background,
  },
  thinkingRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  thinkingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  thinkingText: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  failure: {
    marginLeft: 39,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  composerWrap: {
    padding: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  composer: {
    minHeight: 54,
    paddingHorizontal: 14,
    paddingRight: 4,
    borderRadius: radius.lg,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    minWidth: 0,
    maxHeight: 110,
    paddingVertical: 14,
    color: colors.text,
    fontFamily,
    ...typography.input,
  },
  sendButton: {
    width: 42,
    height: 42,
    margin: 6,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  sendDisabled: {
    backgroundColor: colors.border,
  },
  sendPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.96 }],
  },
});
