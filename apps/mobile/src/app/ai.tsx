import {
  errorMessage,
  useCreateThread,
  useCreateTurn,
  useGetCurrentThread,
  useGetOperation,
  useListMessages,
  useListProposals,
  type ActionProposal,
  type AssistantMessage,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useReducer, useRef, useState } from 'react';
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
import { AssistantMarkdown } from '@/features/assistant/assistant-markdown';
import {
  assistantThreadSessionReducer,
  createAssistantThreadSession,
} from '@/features/assistant/assistant-thread-session';
import { ProposalCard } from '@/features/assistant/proposal-card';
import { useTurnStream } from '@/features/assistant/use-turn-stream';
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

  const params = useLocalSearchParams<{ threadId?: string }>();
  const [threadSession, dispatchThread] = useReducer(
    assistantThreadSessionReducer,
    createAssistantThreadSession(params.threadId),
  );
  const threadId = threadSession.threadId;
  const [turnId, setTurnId] = useState('');
  const [operationId, setOperationId] = useState('');
  const [input, setInput] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  // 打开面板只读取今天的默认对话，不创建空 Thread。
  const currentThread = useGetCurrentThread({
    query: {
      enabled: threadSession.mode === 'default' && !threadId,
      refetchOnMount: 'always',
    },
  });

  useEffect(() => {
    const currentId = currentThread.data?.data?.id;
    if (currentId) {
      dispatchThread({ type: 'restore_current', threadId: currentId });
    }
  }, [currentThread.data?.data?.id]);

  useEffect(() => {
    const selectedId = params.threadId?.trim();
    if (selectedId) {
      dispatchThread({ type: 'select_thread', threadId: selectedId });
    }
  }, [params.threadId]);

  // Thread 仍然只在用户真正发出第一条消息时创建。
  const createThread = useCreateThread({
    mutation: {
      onError: (error) => setFailure(errorMessage(error, '没能打开对话，请稍后再试。')),
    },
  });

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

  // 流只是让文字早点出现。它断了、连不上或者根本没启用都不影响正确性：
  // 下面的轮询照常推进，done 之后展示的是落库的那条消息。
  const stream = useTurnStream(thinking ? turnId : '');

  // 回复失败的说明由服务端给，直接派生出来展示，不额外存一份状态。
  const turnFailure =
    turnStatus === 'failed'
      ? errorMessage(operation.data?.data.error, '助理这次没能回复，请稍后再试。')
      : null;
  const restoring =
    threadSession.mode === 'default' &&
    !threadId &&
    (currentThread.isFetching || Boolean(currentThread.data?.data));

  const createTurn = useCreateTurn({
    mutation: {
      onSuccess: (result) => {
        dispatchThread({ type: 'attach_thread', threadId: result.data.thread_id });
        setTurnId(result.data.turn_id);
        setOperationId(result.data.operation_id);
        void messages.refetch();
      },
      onError: (error) => setFailure(errorMessage(error, '消息没能发出去。')),
    },
  });

  const send = async () => {
    const text = input.trim();
    if (!text || thinking || restoring || createThread.isPending || createTurn.isPending) return;
    setFailure(null);
    setInput('');
    try {
      // 服务端按用户时区复用当天 Thread；只有用户点过“新对话”才强制新建。
      const id = threadId || (
        await createThread.mutateAsync({
          data: threadSession.mode === 'fresh' ? { force_new: true } : {},
        })
      ).data.id;
      dispatchThread({ type: 'attach_thread', threadId: id });
      await createTurn.mutateAsync({ threadId: id, data: { text } });
    } catch {
      // onError 已经写过提示；没有新输入时把发送失败的正文还给用户。
      setInput((current) => current || text);
    }
  };

  const scrollToLatest = () => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  };

  // 契约按 message_seq 倒序返回，展示要按时间正序。
  const ordered = [...(messages.data?.data ?? [])].reverse();
  const pending = proposals.data?.data ?? [];
  const sending = createThread.isPending || createTurn.isPending;
  const canSend = Boolean(input.trim()) && !thinking && !restoring && !sending;
  const canStartFresh = Boolean(threadId) && !thinking && !sending;
  const restoreFailure = threadSession.mode === 'default' && !threadId && currentThread.isError
    ? errorMessage(currentThread.error, '没能恢复今天的对话，发送时会再试。')
    : null;
  const visibleFailure = failure ?? turnFailure ?? restoreFailure;

  return (
    <ModalSheet maxHeight="84%" onClose={() => router.back()}>
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <AiAssistantAvatar size={36} />
        </View>
        <View style={styles.headerCopy}>
          <Text accessibilityRole="header" style={styles.headerTitle}>AI 管家</Text>
          <Text numberOfLines={1} style={styles.headerStatus}>
            {thinking
              ? stream.label || '正在查你的数据…'
              : restoring
                ? '正在恢复今天的对话…'
                : threadSession.mode === 'fresh'
                  ? '新对话'
                  : threadSession.mode === 'default'
                    ? '今天的对话'
                    : '历史对话'}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="开始新对话"
          accessibilityRole="button"
          accessibilityState={{ disabled: !canStartFresh }}
          disabled={!canStartFresh}
          onPress={() => {
            dispatchThread({ type: 'start_fresh' });
            setTurnId('');
            setOperationId('');
            setInput('');
            setFailure(null);
          }}
          style={({ pressed }) => [
            styles.closeButton,
            !canStartFresh && styles.headerButtonDisabled,
            pressed && canStartFresh && styles.iconPressed,
          ]}
        >
          <AppIcon
            color={canStartFresh ? colors.text : colors.textTertiary}
            name="create-outline"
            size={21}
          />
        </Pressable>
        <Pressable
          accessibilityLabel="历史对话"
          accessibilityRole="button"
          onPress={() => router.push('/assistant/threads')}
          style={({ pressed }) => [styles.closeButton, pressed && styles.iconPressed]}
        >
          <AppIcon name="time-outline" size={21} />
        </Pressable>
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
        {restoring ? (
          <View accessibilityLabel="正在恢复今天的对话" style={styles.restoreState}>
            <ActivityIndicator color={colors.textSecondary} size="small" />
            <Text style={styles.restoreText}>正在恢复今天的对话…</Text>
          </View>
        ) : null}

        {!restoring && ordered.length === 0 && !messages.isLoading ? (
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
            <View style={[styles.bubble, styles.assistantBubble]}>
              {stream.text ? (
                <>
                  <Text style={styles.messageText}>{stream.text}</Text>
                  {stream.truncated ? (
                    <Text style={styles.truncatedHint}>回复较长，完整内容稍后显示…</Text>
                  ) : null}
                </>
              ) : (
                <View style={styles.thinkingBubble}>
                  <ActivityIndicator color={colors.textSecondary} size="small" />
                  <Text style={styles.thinkingText}>{stream.label || '正在查…'}</Text>
                </View>
              )}
            </View>
          </View>
        ) : null}

        {visibleFailure ? (
          <Text style={styles.failure}>{visibleFailure}</Text>
        ) : null}
      </ScrollView>

      <View style={styles.composerWrap}>
        <View style={styles.composer}>
          <TextInput
            accessibilityLabel="输入给 AI 管家的消息"
            editable
            multiline
            onChangeText={setInput}
            placeholder={
              thinking || sending ? '正在回复…' : restoring ? '正在恢复对话…' : '说点什么…'
            }
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
          {isUser ? (
            <Text style={[styles.messageText, styles.userText]}>{message.content}</Text>
          ) : (
            <AssistantMarkdown content={message.content} />
          )}
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
  headerButtonDisabled: {
    opacity: 0.55,
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
  restoreState: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  restoreText: {
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
  truncatedHint: {
    marginTop: 6,
    color: colors.textTertiary,
    fontFamily,
    ...typography.meta,
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
