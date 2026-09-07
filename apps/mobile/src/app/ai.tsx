import {
  createCapture,
  errorMessage,
  useAnswerCaptureQuestion,
  useCancelTurn,
  useCreateThread,
  useCreateTurn,
  useGetCurrentThread,
  useGetOperation,
  useListCaptureQuestions,
  useListMessages,
  useListProposals,
  type ActionProposal,
  type AssistantMessage,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
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
  AssistantCaptureFlow,
  CaptureQuestionPrompt,
} from '@/features/capture/assistant-capture-flow';
import {
  useCaptureAssistantSession,
  type CaptureAssistantSession,
} from '@/features/capture/capture-assistant-session';
import {
  assistantCaptureDraftSummary,
  buildAssistantCaptureParts,
} from '@/features/assistant/assistant-media-capture';
import {
  assistantThreadSessionReducer,
  createAssistantThreadSession,
} from '@/features/assistant/assistant-thread-session';
import { assistantOperationState } from '@/features/assistant/assistant-operation-state';
import { ProposalCard } from '@/features/assistant/proposal-card';
import { useTurnStream } from '@/features/assistant/use-turn-stream';
import { useImagePicker } from '@/features/capture/use-media-picker';
import { useMediaUpload, type LocalMedia } from '@/features/capture/use-media-upload';
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

  const params = useLocalSearchParams<{
    captureId?: string;
    draft?: string;
    intent?: string;
    operationId?: string;
    projectId?: string;
    threadId?: string;
    taskAction?: string;
    taskId?: string;
  }>();
  const {
    clearSession: clearCaptureSession,
    openSession: storeCaptureSession,
    session: storedCaptureSession,
  } = useCaptureAssistantSession();
  const [captureSessionOverride, setCaptureSessionOverride] = useState<CaptureAssistantSession | null>(null);
  const [completedCaptureId, setCompletedCaptureId] = useState<string | null>(null);
  const [completedCaptureSummary, setCompletedCaptureSummary] = useState<string | null>(null);
  const routeCaptureSession: CaptureAssistantSession | null = params.captureId
    ? {
        captureId: params.captureId,
        operationId: params.operationId,
        draft: params.draft,
        intent: params.intent,
        projectId: params.projectId,
      }
    : null;
  const captureSession = captureSessionOverride
    ?? (routeCaptureSession?.captureId === completedCaptureId ? null : routeCaptureSession)
    ?? (storedCaptureSession?.captureId === completedCaptureId ? null : storedCaptureSession);
  const [threadSession, dispatchThread] = useReducer(
    assistantThreadSessionReducer,
    createAssistantThreadSession(params.threadId),
  );
  const threadId = threadSession.threadId;
  const [turnId, setTurnId] = useState('');
  const [operationId, setOperationId] = useState('');
  const [input, setInput] = useState(() => taskActionDraft(params.taskAction, params.taskId));
  const [images, setImages] = useState<LocalMedia[]>([]);
  const [showMediaMenu, setShowMediaMenu] = useState(false);
  const [submittingCapture, setSubmittingCapture] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [questionAnswer, setQuestionAnswer] = useState('');
  const [questionFailure, setQuestionFailure] = useState<string | null>(null);
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
    { query: { staleTime: 15_000 } },
  );
  const captureQuestions = useListCaptureQuestions(
    { status: 'open', limit: 100 },
    { query: { staleTime: 5_000 } },
  );
  const answerCaptureQuestion = useAnswerCaptureQuestion();

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
  const { settled, recovering } = assistantOperationState(turnStatus, operation.isError);
  // 状态还没拉回来时也算"正在回复"，否则用户能在同一轮里连发两条。
  const thinking = Boolean(operationId) && !settled;

  const cancelTurn = useCancelTurn({
    mutation: {
      onSuccess: () => void operation.refetch(),
      onError: (error) => setFailure(errorMessage(error, '没能停止这次回复，请稍后再试。')),
    },
  });

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
  useEffect(() => {
    if (!stream.done) return;
    // done 在服务端提交事务后发布，立即读取权威卡片；断线仍由轮询恢复。
    void operation.refetch();
    void messages.refetch();
    void proposals.refetch();
    // 与轮询收尾一致，仅在当前轮次第一次收到明确完成时触发。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnId, stream.done]);

  // 回复失败的说明由服务端给，直接派生出来展示，不额外存一份状态。
  const turnFailure =
    turnStatus === 'failed'
      ? errorMessage(operation.data?.data.error, '助理这次没能回复，请稍后再试。')
      : recovering
        ? errorMessage(operation.error, '网络连接暂时中断，正在恢复回复状态，请稍候。')
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

  const send = async (choice?: { messageId: string; id: string; label: string }) => {
    const text = choice?.label ?? input.trim();
    if (
      (!hasVisibleMessage(text) && images.length === 0)
      || thinking
      || restoring
      || createThread.isPending
      || createTurn.isPending
      || submittingCapture
      || media.uploading
    ) return;
    setFailure(null);
    setShowMediaMenu(false);

    if (images.length > 0 && !choice) {
      setSubmittingCapture(true);
      try {
        const uploaded = await media.upload(images);
        const response = await createCapture({
          origin: 'assistant',
          parts: buildAssistantCaptureParts(text, uploaded),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        if (!response.data.resource_id) throw new Error('服务端没有返回 Capture 引用');
        const draft = assistantCaptureDraftSummary(text, images.length);
        setInput('');
        setImages([]);
        const next = {
          captureId: response.data.resource_id,
          operationId: response.data.operation_id,
          draft,
          intent: 'assistant',
        };
        setCompletedCaptureSummary(null);
        setCaptureSessionOverride(next);
        storeCaptureSession(next);
      } catch (error) {
        setFailure(errorMessage(error, '图片没能发出去，请稍后重试。'));
      } finally {
        setSubmittingCapture(false);
      }
      return;
    }

    if (!choice) setInput('');
    try {
      // 服务端按用户时区复用当天 Thread；只有用户点过“新对话”才强制新建。
      const id = threadId || (
        await createThread.mutateAsync({
          data: threadSession.mode === 'fresh' ? { force_new: true } : {},
        })
      ).data.id;
      dispatchThread({ type: 'attach_thread', threadId: id });
      await createTurn.mutateAsync({ threadId: id, data: { text, ...(choice ? { clarification_message_id: choice.messageId, choice_id: choice.id } : {}) } });
    } catch {
      // onError 已经写过提示；没有新输入时把发送失败的正文还给用户。
      setInput((current) => current || text);
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
  const attachedProposalIds = new Set(ordered.flatMap((message) => message.proposal_ids ?? []));
  const standaloneProposals = pending.filter((proposal) => !attachedProposalIds.has(proposal.id));
  const currentQuestion = (captureQuestions.data?.data ?? []).find(
    (question) => !captureSession || question.capture_id === captureSession.captureId,
  );
  const standaloneQuestion = captureSession ? undefined : currentQuestion;
  const sending = createThread.isPending || createTurn.isPending || submittingCapture || media.uploading;
  const captureDecisionPending = Boolean(captureSession || standaloneQuestion);
  const canSend = Boolean(hasVisibleMessage(input) || images.length)
    && !thinking
    && !restoring
    && !sending
    && !captureDecisionPending;
  const canStartFresh = Boolean(threadId) && !thinking && !sending;
  const restoreFailure = threadSession.mode === 'default' && !threadId && currentThread.isError
    ? errorMessage(currentThread.error, '没能恢复今天的对话，发送时会再试。')
    : null;
  const visibleFailure = failure ?? picker.error ?? turnFailure ?? restoreFailure;

  const startCaptureSession = (next: CaptureAssistantSession) => {
    setCompletedCaptureId(null);
    setCompletedCaptureSummary(null);
    setCaptureSessionOverride(next);
    storeCaptureSession(next);
  };

  const submitStandaloneQuestion = async (value: string) => {
    const normalized = value.trim();
    if (!standaloneQuestion || !normalized || answerCaptureQuestion.isPending) return;
    setQuestionFailure(null);
    try {
      const response = await answerCaptureQuestion.mutateAsync({
        questionId: standaloneQuestion.id,
        data: { answer: normalized },
      });
      setQuestionAnswer('');
      startCaptureSession({
        captureId: response.data.resource_id ?? standaloneQuestion.capture_id,
        operationId: response.data.operation_id,
        draft: normalized,
      });
      await queryClient.invalidateQueries();
    } catch (error) {
      setQuestionFailure(errorMessage(error, '这条补充暂时没能提交，请重试。'));
    }
  };

  const reenterCapture = () => {
    const current = captureSession;
    clearCaptureSession();
    setCaptureSessionOverride(null);
    router.replace({
      pathname: '/capture/new',
      params: { intent: current?.intent, projectId: current?.projectId },
    });
  };

  const closeAssistant = () => {
    if (captureSession) storeCaptureSession(captureSession);
    router.back();
  };

  return (
    <ModalSheet maxHeight="84%" onClose={closeAssistant}>
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <AiAssistantAvatar size={36} />
        </View>
        <View style={styles.headerCopy}>
          <Text accessibilityRole="header" style={styles.headerTitle}>AI 管家</Text>
          <Text numberOfLines={1} style={styles.headerStatus}>
            {captureSession
              ? '正在处理这次输入'
              : standaloneQuestion
                ? '有一项需要你补充'
                : thinking
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
          onPress={closeAssistant}
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

        {!restoring
        && ordered.length === 0
        && !messages.isLoading
        && !captureSession
        && !standaloneQuestion
        && standaloneProposals.length === 0
        && !completedCaptureSummary ? (
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
            onChoice={message.id === ordered.at(-1)?.id && !thinking && !sending
              ? (id, label) => { void send({ messageId: message.id, id, label }); }
              : undefined}
            proposals={pending.filter((p) => message.proposal_ids?.includes(p.id))}
            onProposalResolved={() => {
              void proposals.refetch();
              // 建议执行后会改到任务、日程等正式内容，缓存必须整体失效。
              void queryClient.invalidateQueries();
            }}
          />
        ))}

        {standaloneProposals.length > 0 ? (
          <View style={styles.standaloneProposals}>
            <Text style={styles.standaloneProposalTitle}>待你确认的建议</Text>
            {standaloneProposals.map((proposal) => (
              <ProposalCard
                key={proposal.id}
                onResolved={() => {
                  void proposals.refetch();
                  void queryClient.invalidateQueries();
                }}
                proposal={proposal}
              />
            ))}
          </View>
        ) : null}

        {standaloneQuestion ? (
          <View style={styles.capturePromptRow}>
            <View style={styles.assistantMark}>
              <AiAssistantAvatar size={30} />
            </View>
            <View style={styles.capturePromptBubble}>
              <CaptureQuestionPrompt
                answer={questionAnswer}
                error={questionFailure}
                onAnswerChange={(value) => {
                  setQuestionAnswer(value);
                  setQuestionFailure(null);
                }}
                onSubmit={submitStandaloneQuestion}
                question={standaloneQuestion}
                submitting={answerCaptureQuestion.isPending}
              />
            </View>
          </View>
        ) : null}

        {captureSession ? (
          <AssistantCaptureFlow
            onCompleted={(summary) => {
              clearCaptureSession();
              setCompletedCaptureId(captureSession.captureId);
              setCaptureSessionOverride(null);
              setCompletedCaptureSummary(summary);
            }}
            onReenterCapture={reenterCapture}
            onSessionChange={startCaptureSession}
            session={captureSession}
          />
        ) : null}

        {completedCaptureSummary ? (
          <View style={styles.capturePromptRow}>
            <View style={styles.assistantMark}>
              <AiAssistantAvatar size={30} />
            </View>
            <View style={styles.capturePromptBubble}>
              <View style={styles.captureCompleted}>
                <AppIcon color={colors.primaryStrong} name="checkmark-circle-outline" size={21} />
                <View style={styles.captureCompletedCopy}>
                  <Text style={styles.captureCompletedTitle}>{completedCaptureSummary}</Text>
                  <Text style={styles.captureCompletedText}>需要的话可以继续和我说。</Text>
                </View>
              </View>
            </View>
          </View>
        ) : null}

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
        {images.length > 0 ? (
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

        {showMediaMenu ? (
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
          <Pressable
            accessibilityLabel="添加图片"
            accessibilityRole="button"
            accessibilityState={{ disabled: thinking || restoring || sending || captureDecisionPending }}
            disabled={thinking || restoring || sending || captureDecisionPending}
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
          <TextInput
            accessibilityLabel="输入给 AI 管家的消息"
            editable={!captureDecisionPending && !restoring && !sending}
            multiline
            onChangeText={setInput}
            onFocus={() => setShowMediaMenu(false)}
            placeholder={
              captureDecisionPending
                ? '先处理上面的整理结果…'
                : thinking || sending
                ? '正在处理…'
                : restoring
                  ? '正在恢复对话…'
                  : images.length
                    ? '补一句想怎么处理…'
                    : '说点什么…'
            }
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
            value={input}
          />
          <Pressable
            accessibilityLabel={thinking ? '停止回复' : '发送消息'}
            accessibilityRole="button"
            accessibilityState={{ disabled: thinking ? cancelTurn.isPending : !canSend }}
            disabled={thinking ? cancelTurn.isPending : !canSend}
            onPress={thinking
              ? () => cancelTurn.mutate({ turnId })
              : () => { void send(); }}
            style={({ pressed }) => [
              styles.sendButton,
              ((!thinking && !canSend) || cancelTurn.isPending) && styles.sendDisabled,
              pressed && (thinking || canSend) && styles.sendPressed,
            ]}
          >
            <AppIcon
              color={thinking || canSend ? colors.background : colors.textSecondary}
              name={thinking ? 'close' : 'arrow-up'}
              size={19}
            />
          </Pressable>
        </View>
      </View>
    </ModalSheet>
  );
}

/** Task 详情仅传稳定 ID；私人标题和描述由服务端只读能力按当前用户重新读取。 */
function taskActionDraft(action?: string, rawTaskID?: string): string {
  const taskID = rawTaskID?.trim();
  if (!taskID?.startsWith('tsk_')) return '';
  if (action === 'split') {
    return `请先读取任务 ${taskID} 的最新版本，再把它拆成 2 到 10 个可执行的子任务。只生成一条批量待确认建议，不要直接写入，也不要自动完成原任务。`;
  }
  if (action === 'schedule') {
    return `请先读取任务 ${taskID}、我的工作时间以及现有日程，给出首选和最多 3 个备选时间段。只生成包含计划开始与结束时间的待确认建议，不要直接修改任务。`;
  }
  return '';
}

function MessageRow({
  message,
  proposals,
  onProposalResolved,
  onChoice,
}: {
  message: AssistantMessage;
  proposals: ActionProposal[];
  onProposalResolved: () => void;
  onChoice?: (id: string, label: string) => void;
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

      {message.interaction?.choices?.map((choice) => (
        <Pressable
          key={choice.id}
          accessibilityRole="button"
          accessibilityLabel={choice.label}
          disabled={!onChoice}
          onPress={() => onChoice?.(choice.id, choice.label)}
          style={[styles.bubble, { opacity: onChoice ? 1 : 0.5 }]}
        >
          <Text style={styles.messageText}>{choice.label}</Text>
        </Pressable>
      ))}
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
  capturePromptRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  capturePromptBubble: {
    minWidth: 0,
    flex: 1,
    padding: 14,
    borderRadius: radius.lg,
    borderTopLeftRadius: 7,
    backgroundColor: colors.surfaceSubtle,
  },
  captureCompleted: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  captureCompletedCopy: {
    minWidth: 0,
    flex: 1,
    gap: 3,
  },
  captureCompletedTitle: {
    color: colors.text,
    fontFamily,
    ...typography.bodyStrong,
  },
  captureCompletedText: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  standaloneProposals: {
    gap: 10,
  },
  standaloneProposalTitle: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    fontWeight: '600',
  },
  composerWrap: {
    padding: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
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

/** 只判定全不可见输入，不改写正文里的 Emoji 连接符。 */
function hasVisibleMessage(text: string): boolean {
  return /[^\s\p{Cf}\p{Cc}]/u.test(text);
}
