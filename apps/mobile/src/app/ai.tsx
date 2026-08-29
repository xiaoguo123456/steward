import {
  createCapture,
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
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { type PropsWithChildren, useEffect, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AiAssistantAvatar } from '@/components/ui/ai-assistant-avatar';
import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { ModalSheet } from '@/components/ui/modal-sheet';
import { NavHeader } from '@/components/ui/nav-header';
import { AssistantMarkdown } from '@/features/assistant/assistant-markdown';
import { takeAssistantDraft } from '@/features/assistant/assistant-draft-store';
import {
  assistantCaptureDraftSummary,
  buildAssistantCaptureParts,
} from '@/features/assistant/assistant-media-capture';
import {
  assistantThreadSessionReducer,
  createAssistantThreadSession,
} from '@/features/assistant/assistant-thread-session';
import { ProposalCard } from '@/features/assistant/proposal-card';
import { useTurnStream } from '@/features/assistant/use-turn-stream';
import { useImagePicker } from '@/features/capture/use-media-picker';
import { useMediaUpload, type LocalMedia } from '@/features/capture/use-media-upload';
import {
  buildInspirationNoteCaptureText,
  buildInspirationTaskProposalRequest,
  buildInspirationTurnText,
  visibleInspirationUserText,
} from '@/features/inspiration/inspiration-conversation';
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
  const [initialDraft] = useState(() => takeAssistantDraft());
  const inspirationMode = initialDraft?.surface === 'inspiration';
  const [threadSession, dispatchThread] = useReducer(
    assistantThreadSessionReducer,
    createAssistantThreadSession(params.threadId, inspirationMode),
  );
  const threadId = threadSession.threadId;
  const [turnId, setTurnId] = useState('');
  const [operationId, setOperationId] = useState('');
  const [input, setInput] = useState(initialDraft?.text ?? '');
  const [draftContextLabel, setDraftContextLabel] = useState<string | null>(
    inspirationMode ? null : initialDraft?.contextLabel ?? null,
  );
  const [needsInspirationContext, setNeedsInspirationContext] = useState(
    inspirationMode && Boolean(initialDraft?.firstTurnContext),
  );
  const [images, setImages] = useState<LocalMedia[]>([]);
  const [showMediaMenu, setShowMediaMenu] = useState(false);
  const [submittingCapture, setSubmittingCapture] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const picker = useImagePicker();
  const media = useMediaUpload();

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

  const sendText = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (
      (!text && images.length === 0)
      || thinking
      || restoring
      || createThread.isPending
      || createTurn.isPending
      || submittingCapture
      || media.uploading
    ) return;
    setFailure(null);
    setShowMediaMenu(false);

    if (images.length > 0 && overrideText === undefined) {
      setSubmittingCapture(true);
      try {
        const uploaded = await media.upload(images);
        const response = await createCapture({
          origin: 'assistant',
          parts: buildAssistantCaptureParts(text, uploaded),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        const draft = assistantCaptureDraftSummary(text, images.length);
        setInput('');
        setDraftContextLabel(null);
        setImages([]);
        router.replace({
          pathname: '/capture/processing',
          params: {
            captureId: response.data.resource_id ?? '',
            operationId: response.data.operation_id,
            draft,
          },
        });
      } catch (error) {
        setFailure(errorMessage(error, '图片没能发出去，请稍后重试。'));
      } finally {
        setSubmittingCapture(false);
      }
      return;
    }

    if (overrideText === undefined) setInput('');
    try {
      // 服务端按用户时区复用当天 Thread；只有用户点过“新对话”才强制新建。
      const id = threadId || (
        await createThread.mutateAsync({
          data: threadSession.mode === 'fresh' ? { force_new: true } : {},
        })
      ).data.id;
      dispatchThread({ type: 'attach_thread', threadId: id });
      const turnText = needsInspirationContext && initialDraft?.firstTurnContext
        ? buildInspirationTurnText(initialDraft.firstTurnContext, text)
        : text;
      await createTurn.mutateAsync({ threadId: id, data: { text: turnText } });
      setNeedsInspirationContext(false);
      setDraftContextLabel(null);
    } catch {
      // onError 已经写过提示；没有新输入时把发送失败的正文还给用户。
      if (overrideText === undefined) setInput((current) => current || text);
    }
  };

  const addImages = async (source: 'camera' | 'library') => {
    setShowMediaMenu(false);
    setFailure(null);
    picker.clearError();
    const picked = await picker.pick(source);
    setImages((current) => [...current, ...picked].slice(0, 9));
  };

  const scrollToLatest = () => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  };

  // 契约按 message_seq 倒序返回，展示要按时间正序。
  const ordered = [...(messages.data?.data ?? [])].reverse();
  const pending = proposals.data?.data ?? [];
  const sending = createThread.isPending || createTurn.isPending || submittingCapture || media.uploading;
  const canSend = Boolean(input.trim() || images.length) && !thinking && !restoring && !sending;
  const canStartFresh = Boolean(threadId) && !thinking && !sending;
  const hasInspirationExchange = inspirationMode
    && ordered.some((message) => message.role === 'user')
    && ordered.some((message) => message.role === 'assistant');
  const showInspirationActions = hasInspirationExchange
    && pending.length === 0
    && !thinking
    && !sending
    && !input.trim();
  const restoreFailure = threadSession.mode === 'default' && !threadId && currentThread.isError
    ? errorMessage(currentThread.error, '没能恢复今天的对话，发送时会再试。')
    : null;
  const visibleFailure = failure ?? picker.error ?? turnFailure ?? restoreFailure;

  const organizeAsNote = async () => {
    if (!showInspirationActions) return;
    setFailure(null);
    setSubmittingCapture(true);
    try {
      const text = buildInspirationNoteCaptureText(
        initialDraft?.openingPrompt ?? '这次灵感对话',
        ordered,
      );
      const response = await createCapture({
        origin: 'assistant',
        parts: buildAssistantCaptureParts(text, []),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      router.replace({
        pathname: '/capture/processing',
        params: {
          captureId: response.data.resource_id ?? '',
          operationId: response.data.operation_id,
          draft: '整理这次灵感对话',
        },
      });
    } catch (error) {
      setFailure(errorMessage(error, '这次对话暂时没能整理成笔记。'));
    } finally {
      setSubmittingCapture(false);
    }
  };

  return (
    <ConversationFrame fullScreen={inspirationMode} onClose={() => router.back()}>
      {inspirationMode ? (
        <NavHeader title="灵感" />
      ) : (
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
              setDraftContextLabel(null);
              setImages([]);
              setShowMediaMenu(false);
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
      )}

      <ScrollView
        ref={listRef}
        accessibilityLabel={inspirationMode ? '灵感对话' : '与 AI 管家的对话'}
        accessibilityLiveRegion="polite"
        contentContainerStyle={[
          styles.messages,
          inspirationMode && styles.inspirationMessages,
        ]}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={scrollToLatest}
        showsVerticalScrollIndicator={false}
        style={styles.messageList}
      >
        {inspirationMode && initialDraft?.openingPrompt ? (
          <View style={styles.inspirationOpening}>
            <Text style={styles.inspirationOpeningQuestion}>{initialDraft.openingPrompt}</Text>
            {initialDraft.contextLabel ? (
              <Text style={styles.inspirationOpeningContext}>{initialDraft.contextLabel}</Text>
            ) : null}
          </View>
        ) : null}

        {restoring ? (
          <View accessibilityLabel="正在恢复今天的对话" style={styles.restoreState}>
            <ActivityIndicator color={colors.textSecondary} size="small" />
            <Text style={styles.restoreText}>正在恢复今天的对话…</Text>
          </View>
        ) : null}

        {!inspirationMode && !restoring && ordered.length === 0 && !messages.isLoading ? (
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
            inspiration={inspirationMode}
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
          <View style={[styles.thinkingRow, inspirationMode && styles.inspirationThinkingRow]}>
            {inspirationMode ? null : (
              <View style={styles.assistantMark}>
                <AiAssistantAvatar size={30} />
              </View>
            )}
            <View style={[
              styles.bubble,
              styles.assistantBubble,
              inspirationMode && styles.inspirationAssistantBubble,
            ]}>
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
                  <Text style={styles.thinkingText}>{stream.label || '正在想…'}</Text>
                </View>
              )}
            </View>
          </View>
        ) : null}

        {showInspirationActions ? (
          <View style={styles.inspirationActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => void organizeAsNote()}
              style={({ pressed }) => [styles.inspirationAction, pressed && styles.actionPressed]}
            >
              <Text style={styles.inspirationActionPrimary}>整理成笔记</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => void sendText(buildInspirationTaskProposalRequest())}
              style={({ pressed }) => [styles.inspirationAction, pressed && styles.actionPressed]}
            >
              <Text style={styles.inspirationActionSecondary}>生成待办建议</Text>
            </Pressable>
          </View>
        ) : null}

        {visibleFailure ? (
          <Text style={[styles.failure, inspirationMode && styles.inspirationFailure]}>
            {visibleFailure}
          </Text>
        ) : null}
      </ScrollView>

      <View style={[styles.composerWrap, inspirationMode && styles.inspirationComposerWrap]}>
        {draftContextLabel ? (
          <View style={styles.draftContext}>
            <AppIcon color={colors.primaryStrong} name="bulb-outline" size={17} />
            <Text numberOfLines={1} style={styles.draftContextText}>{draftContextLabel}</Text>
            <Text style={styles.draftContextHint}>确认后发送</Text>
          </View>
        ) : null}
        {!inspirationMode && images.length > 0 ? (
          <ScrollView
            contentContainerStyle={styles.imagePreviews}
            horizontal
            keyboardShouldPersistTaps="handled"
            showsHorizontalScrollIndicator={false}
          >
            {images.map((image, index) => (
              <View key={`${image.uri}-${index}`} style={styles.imagePreview}>
                <Image contentFit="cover" source={{ uri: image.uri }} style={styles.imageThumb} />
                <Pressable
                  accessibilityLabel={`删除图片 ${index + 1}`}
                  accessibilityRole="button"
                  onPress={() => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  style={styles.removeImage}
                >
                  <AppIcon color={colors.background} name="close" size={11} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        ) : null}

        {!inspirationMode && showMediaMenu ? (
          <View style={styles.mediaMenu}>
            <Pressable
              accessibilityLabel="拍照"
              accessibilityRole="button"
              onPress={() => void addImages('camera')}
              style={({ pressed }) => [styles.mediaAction, pressed && styles.mediaActionPressed]}
            >
              <AppIcon color={colors.primaryStrong} name="camera-outline" size={20} />
              <Text style={styles.mediaActionText}>拍照</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="从相册选择"
              accessibilityRole="button"
              onPress={() => void addImages('library')}
              style={({ pressed }) => [styles.mediaAction, pressed && styles.mediaActionPressed]}
            >
              <AppIcon color={colors.primaryStrong} name="images-outline" size={20} />
              <Text style={styles.mediaActionText}>相册</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.composer}>
          {inspirationMode ? null : (
            <Pressable
              accessibilityLabel="添加图片"
              accessibilityRole="button"
              accessibilityState={{ disabled: thinking || restoring || sending }}
              disabled={thinking || restoring || sending}
              onPress={() => setShowMediaMenu((current) => !current)}
              style={({ pressed }) => [
                styles.imageButton,
                showMediaMenu && styles.imageButtonActive,
                pressed && styles.mediaActionPressed,
              ]}
            >
              <AppIcon
                color={showMediaMenu ? colors.primaryStrong : colors.textSecondary}
                name="image-outline"
                size={21}
              />
            </Pressable>
          )}
          <TextInput
            accessibilityLabel={inspirationMode ? '写下你的想法' : '输入给 AI 管家的消息'}
            editable
            multiline
            onChangeText={setInput}
            onFocus={() => setShowMediaMenu(false)}
            placeholder={
              thinking || sending
                ? '正在处理…'
                : restoring
                  ? '正在恢复对话…'
                  : inspirationMode
                    ? '写下你的想法…'
                    : images.length
                      ? '补一句想怎么处理…'
                      : '说点什么…'
            }
            placeholderTextColor={colors.textTertiary}
            style={[styles.input, inspirationMode && styles.inspirationInput]}
            value={input}
          />
          <Pressable
            accessibilityLabel="发送消息"
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={() => void sendText()}
            style={({ pressed }) => [
              styles.sendButton,
              inspirationMode && styles.inspirationSendButton,
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
    </ConversationFrame>
  );
}

function ConversationFrame({
  children,
  fullScreen,
  onClose,
}: PropsWithChildren<{ fullScreen: boolean; onClose: () => void }>) {
  if (!fullScreen) {
    return (
      <ModalSheet maxHeight="84%" onClose={onClose}>
        {children}
      </ModalSheet>
    );
  }

  return (
    <AppScreen includeBottomInset>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.fullScreenKeyboard}
      >
        {children}
      </KeyboardAvoidingView>
    </AppScreen>
  );
}

function MessageRow({
  inspiration,
  message,
  proposals,
  onProposalResolved,
}: {
  inspiration: boolean;
  message: AssistantMessage;
  proposals: ActionProposal[];
  onProposalResolved: () => void;
}) {
  const isUser = message.role === 'user';
  const visibleContent = isUser
    ? visibleInspirationUserText(message.content)
    : message.content;

  return (
    <View style={styles.messageGroup}>
      <View style={[
        styles.messageRow,
        isUser && styles.userRow,
        inspiration && !isUser && styles.inspirationAssistantRow,
      ]}>
        {isUser || inspiration ? null : (
          <View style={styles.assistantMark}>
            <AiAssistantAvatar size={30} />
          </View>
        )}
        <View style={[
          styles.bubble,
          isUser ? styles.userBubble : styles.assistantBubble,
          inspiration && isUser && styles.inspirationUserBubble,
          inspiration && !isUser && styles.inspirationAssistantBubble,
        ]}>
          {isUser ? (
            <Text style={[
              styles.messageText,
              styles.userText,
              inspiration && styles.inspirationUserText,
            ]}>
              {visibleContent}
            </Text>
          ) : (
            <AssistantMarkdown content={visibleContent} />
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
  fullScreenKeyboard: {
    flex: 1,
  },
  header: {
    minHeight: 66,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  draftContext: {
    minHeight: 38,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.primarySoft,
  },
  draftContextText: {
    minWidth: 0,
    flex: 1,
    color: colors.primaryStrong,
    fontFamily,
    ...typography.meta,
    fontWeight: '600',
  },
  draftContextHint: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.caption,
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
  messageList: {
    flex: 1,
  },
  inspirationMessages: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 30,
    gap: 20,
  },
  inspirationOpening: {
    paddingTop: 8,
    paddingBottom: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  inspirationOpeningQuestion: {
    color: colors.text,
    fontFamily,
    fontSize: 19,
    lineHeight: 29,
    fontWeight: '500',
    letterSpacing: -0.15,
  },
  inspirationOpeningContext: {
    marginTop: 9,
    color: colors.inspiration,
    fontFamily,
    ...typography.meta,
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
  inspirationAssistantRow: {
    gap: 0,
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
  inspirationAssistantBubble: {
    maxWidth: '100%',
    paddingHorizontal: 0,
    paddingVertical: 2,
    borderRadius: 0,
    backgroundColor: 'transparent',
  },
  inspirationUserBubble: {
    maxWidth: '86%',
    borderTopRightRadius: 7,
    backgroundColor: colors.surface,
  },
  messageText: {
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  userText: {
    color: colors.background,
  },
  inspirationUserText: {
    color: colors.text,
  },
  thinkingRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  inspirationThinkingRow: {
    gap: 0,
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
  inspirationFailure: {
    marginLeft: 0,
  },
  inspirationActions: {
    paddingTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  inspirationAction: {
    minHeight: 44,
    justifyContent: 'center',
  },
  inspirationActionPrimary: {
    color: colors.inspiration,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  inspirationActionSecondary: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  actionPressed: {
    opacity: 0.58,
  },
  composerWrap: {
    padding: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  inspirationComposerWrap: {
    backgroundColor: colors.background,
  },
  inspirationSendButton: {
    backgroundColor: colors.text,
  },
  imagePreviews: {
    paddingBottom: 8,
    gap: 8,
  },
  imagePreview: {
    width: 58,
    height: 58,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  imageThumb: {
    width: '100%',
    height: '100%',
    borderRadius: radius.sm,
  },
  removeImage: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 21,
    height: 21,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.text,
  },
  mediaMenu: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 8,
  },
  mediaAction: {
    minHeight: 42,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.primarySoft,
  },
  mediaActionText: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.label,
  },
  mediaActionPressed: {
    opacity: 0.68,
  },
  composer: {
    minHeight: 54,
    paddingLeft: 5,
    paddingRight: 4,
    borderRadius: radius.lg,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: colors.surface,
  },
  imageButton: {
    width: 42,
    height: 42,
    marginVertical: 6,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageButtonActive: {
    backgroundColor: colors.primarySoft,
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
  inspirationInput: {
    paddingLeft: 11,
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
