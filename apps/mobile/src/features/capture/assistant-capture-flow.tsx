import {
  confirmCapture,
  errorMessage,
  undoActivityBatch,
  useAnswerCaptureQuestion,
  useGetCapture,
  useGetOperation,
  useListCaptureQuestions,
  type CaptureCandidate,
  type CaptureConflict,
  type CaptureDraftPayload,
  type CapturePart,
  type CaptureQuestion,
  type CaptureSourceRef,
  type ConfirmCaptureItem,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AiAssistantAvatar } from '@/components/ui/ai-assistant-avatar';
import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';
import { formatMinuteDateTime } from '@/utils/date-time';
import { CaptureCandidateEditor } from './capture-candidate-editor';
import type { CaptureAssistantSession } from './capture-assistant-session';
import {
  captureConversationPhase,
  capturePartStatusItems,
  captureProcessingCopy,
  type CaptureConversationPhase,
} from './capture-conversation-model';
import {
  applyConflictChoice,
  cloneCapturePayload,
  unresolvedCandidateFields,
} from './capture-confirmation-model';
import { summarizeCaptureResources } from './capture-success-model';

type AssistantCaptureFlowProps = {
  session: CaptureAssistantSession;
  onCompleted: (summary: string) => void;
  onPhaseChange: (captureId: string, phase: CaptureConversationPhase) => void;
  onDefer: () => void;
  onReenterCapture: () => void;
  onSessionChange: (session: CaptureAssistantSession) => void;
};

type CandidateMeta = {
  color: string;
  icon: ComponentProps<typeof AppIcon>['name'];
  label: string;
  soft: string;
};

const typeMeta: Record<CaptureCandidate['candidate_type'], CandidateMeta> = {
  task: { label: '任务', icon: 'checkmark-circle-outline', color: colors.primaryStrong, soft: colors.primarySoft },
  event: { label: '日程', icon: 'calendar-outline', color: '#3978B8', soft: '#EAF4FF' },
  note: { label: '笔记', icon: 'document-text-outline', color: '#7657C8', soft: '#F2EEFF' },
  project: { label: '项目', icon: 'flag-outline', color: '#187A75', soft: '#E9F7F5' },
  tracker: { label: '打卡', icon: 'stats-chart-outline', color: '#B65316', soft: '#FFF1E7' },
  record: { label: '记录', icon: 'analytics-outline', color: '#A83B70', soft: '#FDEEF5' },
};

/**
 * 在 AI 管家对话里承载 Capture 的处理、澄清、确认、保存与失败恢复。
 * 正式状态仍只读取 Operation、Capture 和 Question API。
 */
export function AssistantCaptureFlow({
  onCompleted,
  onPhaseChange,
  onDefer,
  onReenterCapture,
  onSessionChange,
  session,
}: AssistantCaptureFlowProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const operation = useGetOperation(session.operationId ?? '', {
    query: {
      enabled: Boolean(session.operationId),
      refetchInterval: (query) => {
        const status = query.state.data?.data.status;
        return status === 'succeeded' || status === 'failed' || status === 'cancelled'
          ? false
          : 800;
      },
    },
  });
  const capture = useGetCapture(session.captureId, {
    query: {
      enabled: Boolean(session.captureId),
      refetchInterval: (query) => {
        const status = query.state.data?.data.status;
        return status === 'draft'
          || status === 'submitting'
          || status === 'preprocessing'
          || status === 'parsing'
          ? 1_000
          : false;
      },
    },
  });
  const questions = useListCaptureQuestions(
    { status: 'open', limit: 100 },
    { query: { staleTime: 5_000 } },
  );
  const answerQuestion = useAnswerCaptureQuestion();
  const [answer, setAnswer] = useState('');
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, CaptureDraftPayload>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [conflictChoices, setConflictChoices] = useState<Record<string, string>>({});
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const data = capture.data?.data;
  const candidates = useMemo(() => data?.candidates ?? [], [data]);
  const question = (questions.data?.data ?? []).find(
    (item) => item.capture_id === session.captureId,
  );
  const operationStatus = operation.data?.data.status;
  const phase = captureConversationPhase({
    captureFailed: capture.isError,
    captureStatus: data?.status,
    operationFailed: operation.isError,
    operationStatus,
  });

  useEffect(() => {
    onPhaseChange(session.captureId, phase);
  }, [onPhaseChange, session.captureId, phase]);

  useEffect(() => {
    if (operationStatus !== 'succeeded') return;
    void capture.refetch();
    void questions.refetch();
    // 查询对象每次渲染会产生新引用，只监听服务端状态变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operationStatus, session.operationId]);

  const isSelected = (candidate: CaptureCandidate) =>
    selection[candidate.id] ?? candidate.selected;
  const draftFor = (candidate: CaptureCandidate) => drafts[candidate.id] ?? candidate.payload;
  const selectedCandidates = candidates.filter(isSelected);
  const pendingTrackers = Object.fromEntries(candidates.flatMap((candidate) => {
    const tracker = draftFor(candidate).tracker;
    return tracker ? [[candidate.id, tracker]] : [];
  }));
  const hasUnselectedTracker = selectedCandidates.some((candidate) => {
    const ref = draftFor(candidate).record?.tracker_ref;
    return ref && pendingTrackers[ref] && !selectedCandidates.some((item) => item.id === ref);
  });
  const blockedCandidates = selectedCandidates.filter(
    (candidate) => unresolvedCandidateFields(candidate, draftFor(candidate)).length > 0,
  );
  const unresolvedConflictCount = (data?.conflicts ?? []).filter(
    (conflict) => !conflictChoices[conflict.id],
  ).length;
  const canSave = selectedCandidates.length > 0
    && blockedCandidates.length === 0
    && unresolvedConflictCount === 0
    && !hasUnselectedTracker
    && !saving;
  const onlyCandidate = candidates.length === 1 ? candidates[0] : undefined;
  const currentSaveHint = hasUnselectedTracker ? '请同时选择这条记录所属的新打卡。' : saveHint(
    selectedCandidates.length,
    blockedCandidates.length,
    unresolvedConflictCount,
  );

  const submitAnswer = async (value: string) => {
    const normalized = value.trim();
    if (!question || !normalized || answerQuestion.isPending) return;
    setAnswerError(null);
    try {
      const response = await answerQuestion.mutateAsync({
        questionId: question.id,
        data: { answer: normalized },
      });
      const next = {
        ...session,
        captureId: response.data.resource_id ?? question.capture_id,
        operationId: response.data.operation_id,
        draft: normalized,
      };
      setAnswer('');
      setSelection({});
      setDrafts({});
      setConflictChoices({});
      onSessionChange(next);
      await queryClient.invalidateQueries();
    } catch (error) {
      setAnswerError(errorMessage(error, '这条补充暂时没能提交，请重试。'));
    }
  };

  const chooseConflict = (conflict: CaptureConflict, value: string, refs: CaptureSourceRef[]) => {
    const ordered = [...candidates].sort((left, right) => (
      Number(sharesSource(right.source_refs, refs)) - Number(sharesSource(left.source_refs, refs))
    ));
    for (const candidate of ordered) {
      const result = applyConflictChoice(
        draftFor(candidate),
        candidate.candidate_type,
        conflict.field,
        value,
      );
      if (!result.changed) continue;
      setDrafts((current) => ({ ...current, [candidate.id]: result.payload }));
      setConflictChoices((current) => ({ ...current, [conflict.id]: value }));
      setConflictError(null);
      return;
    }
    setConflictError('这处歧义无法对应到可编辑字段，请补充说明后重新整理。');
  };

  const save = async () => {
    if (!data || !canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      const items: ConfirmCaptureItem[] = selectedCandidates.map((candidate) => ({
        candidate_id: candidate.id,
        payload: cloneCapturePayload(draftFor(candidate)),
      }));
      const response = await confirmCapture(session.captureId, { revision: data.revision, items });
      await queryClient.invalidateQueries();
      const summary = summarizeCaptureResources(
        response.data.affected_resources,
        selectedCandidates.length,
      );
      const activityBatchId = response.data.capture.activity_batch_id;
      showToast(`${summary.text}已保存`, activityBatchId ? {
        actionLabel: '撤销',
        durationMs: 3_000,
        onAction: async () => {
          try {
            await undoActivityBatch(activityBatchId);
            await queryClient.invalidateQueries();
            showToast('本次保存已撤销');
          } catch (error) {
            showToast(errorMessage(error, '暂时无法撤销，请稍后重试。'));
          }
        },
      } : undefined);
      onCompleted(`${summary.text}已保存`);
    } catch (error) {
      setSaveError(errorMessage(error, '保存失败，请检查网络后重试。'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.flow}>
      {session.draft ? (
        <View style={styles.userRow}>
          <View style={styles.userBubble}>
            <Text style={styles.userText}>{session.draft}</Text>
          </View>
        </View>
      ) : null}

      <AssistantRow>
        {phase === 'processing' ? (
          <View accessibilityLabel={captureProcessingCopy(data?.status)} style={styles.processingState}>
            <View style={styles.statusRow}>
              <ActivityIndicator color={colors.primary} size="small" />
              <View style={styles.statusCopy}>
                <Text style={styles.statusTitle}>{captureProcessingCopy(data?.status)}</Text>
                <Text style={styles.statusText}>整理完成后会先在这里请你确认，不会直接保存。</Text>
              </View>
            </View>
            <CapturePartStatuses parts={data?.parts ?? []} />
          </View>
        ) : phase === 'clarification' ? (
          question ? (
            <CaptureQuestionPrompt
              answer={answer}
              error={answerError}
              onAnswerChange={(value) => {
                setAnswer(value);
                setAnswerError(null);
              }}
              onSubmit={submitAnswer}
              question={question}
              submitting={answerQuestion.isPending}
            />
          ) : (
            <View style={styles.recovery}>
              <View style={styles.statusRow}>
                <ActivityIndicator color={colors.primary} size="small" />
                <View style={styles.statusCopy}>
                  <Text style={styles.statusTitle}>正在读取需要你补充的问题…</Text>
                  <Text style={styles.statusText}>问题状态会从服务端恢复，不会根据旧消息猜测。</Text>
                </View>
              </View>
              {!questions.isPending ? (
                <AppButton
                  compact
                  disabled={questions.isFetching}
                  label={questions.isFetching ? '正在重新加载…' : '重新加载'}
                  onPress={() => void questions.refetch()}
                  variant="secondary"
                />
              ) : null}
            </View>
          )
        ) : phase === 'confirmation' ? (
          <View style={styles.confirmation}>
            <Text style={styles.statusTitle}>已整理 {candidates.length} 项，请确认后保存。</Text>

            {(data?.conflicts?.length ?? 0) > 0 ? (
              <View style={styles.conflicts}>
                <Text style={styles.warningTitle}>先确认有歧义的信息</Text>
                {data?.conflicts?.map((conflict) => (
                  <View key={conflict.id} style={styles.conflictItem}>
                    <Text style={styles.conflictLabel}>
                      {conflict.description ?? `${missingFieldLabel(conflict.field)}存在多个取值`}
                    </Text>
                    {conflict.options.map((option) => {
                      const selected = conflictChoices[conflict.id] === option.value;
                      return (
                        <Pressable
                          accessibilityRole="radio"
                          accessibilityState={{ checked: selected }}
                          key={option.value}
                          onPress={() => chooseConflict(conflict, option.value, option.source_refs)}
                          style={({ pressed }) => [
                            styles.option,
                            selected && styles.optionSelected,
                            pressed && styles.pressed,
                          ]}
                        >
                          <AppIcon
                            color={selected ? colors.primaryStrong : colors.textSecondary}
                            name={selected ? 'radio-button-on' : 'radio-button-off'}
                            size={18}
                          />
                          <Text style={styles.optionText}>{option.value}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
                {conflictError ? <Text style={styles.error}>{conflictError}</Text> : null}
              </View>
            ) : null}

            {candidates.length === 0 ? (
              <View style={styles.emptyResult}>
                <Text style={styles.statusText}>这次没有识别出可以保存的内容。</Text>
                <AppButton compact label="换个说法" onPress={onReenterCapture} variant="secondary" />
              </View>
            ) : (
              <View style={styles.candidates}>
                {candidates.map((candidate, index) => {
                  const draft = draftFor(candidate);
                  const meta = candidateMeta(candidate, draft);
                  const selected = isSelected(candidate);
                  const editing = editingId === candidate.id;
                  const missing = unresolvedCandidateFields(candidate, draft);
                  return (
                    <View
                      key={candidate.id}
                      style={[styles.candidate, index > 0 && styles.candidateDivider]}
                    >
                      <View style={styles.candidateHead}>
                        <View style={styles.candidateIdentity}>
                          <View style={[styles.typeChip, { backgroundColor: meta.soft }]}>
                            <AppIcon color={meta.color} name={meta.icon} size={14} />
                            <Text style={[styles.typeText, { color: meta.color }]}>{meta.label}</Text>
                          </View>
                          <Text style={styles.candidateTitle}>{candidateTitle(draft, pendingTrackers)}</Text>
                        </View>
                        <Pressable
                          accessibilityLabel={`${selected ? '取消选择' : '选择'}${meta.label}`}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: selected }}
                          onPress={() => setSelection((current) => ({
                            ...current,
                            [candidate.id]: !selected,
                          }))}
                          style={({ pressed }) => [
                            styles.checkbox,
                            pressed && styles.pressed,
                          ]}
                        >
                          <View style={[
                            styles.checkboxIndicator,
                            selected && styles.checkboxIndicatorSelected,
                          ]}>
                            {selected ? <AppIcon color={colors.background} name="checkmark" size={13} /> : null}
                          </View>
                        </Pressable>
                      </View>
                      <SourceSummary candidate={candidate} parts={data?.parts ?? []} />
                      {missing.length > 0 ? (
                        <Text style={styles.error}>还需补全：{missing.map(missingFieldLabel).join('、')}</Text>
                      ) : null}
                      {(candidate.warnings?.length ?? 0) > 0 ? (
                        <Text style={styles.warning}>{candidate.warnings?.join('；')}</Text>
                      ) : null}
                      {candidate.duplicate_of ? (
                        <Text style={styles.warning}>可能与已有内容重复，请重点核对。</Text>
                      ) : null}
                      {candidateDetail(draft, pendingTrackers) ? (
                        <Text style={styles.candidateDetail}>{candidateDetail(draft, pendingTrackers)}</Text>
                      ) : null}
                      {!onlyCandidate ? (
                        <AppButton
                          accessibilityLabel={editing ? `收起${meta.label}编辑` : `编辑${meta.label}`}
                          compact
                          label="编辑"
                          onPress={() => setEditingId(editing ? null : candidate.id)}
                          style={styles.editButton}
                          variant="secondary"
                        />
                      ) : null}
                      {editing ? (
                        <CaptureCandidateEditor
                          candidate={candidate}
                          pendingTrackers={pendingTrackers}
                          onChange={(payload) => setDrafts((current) => ({
                            ...current,
                            [candidate.id]: payload,
                          }))}
                          payload={draft}
                        />
                      ) : null}
                    </View>
                  );
                })}
              </View>
            )}

            {saveError ? (
              <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.error}>
                {saveError}
              </Text>
            ) : null}
            {candidates.length > 0 ? (
              <View style={styles.saveArea}>
                {currentSaveHint ? <Text style={styles.saveHint}>{currentSaveHint}</Text> : null}
                {onlyCandidate ? (
                  <View style={styles.confirmationActions}>
                    <AppButton
                      accessibilityLabel={editingId === onlyCandidate.id ? '收起编辑' : '编辑当前内容'}
                      compact
                      label="编辑"
                      onPress={() => setEditingId((current) => (
                        current === onlyCandidate.id ? null : onlyCandidate.id
                      ))}
                      style={styles.confirmationAction}
                      variant="secondary"
                    />
                    <AppButton
                      compact
                      disabled={!canSave}
                      label={saving ? '保存中…' : '保存'}
                      onPress={() => void save()}
                      style={styles.confirmationAction}
                    />
                  </View>
                ) : (
                  <AppButton
                    disabled={!canSave}
                    label={saving ? '保存中…' : '保存'}
                    onPress={() => void save()}
                  />
                )}
              </View>
            ) : null}
          </View>
        ) : phase === 'partial_failure' ? (
          <View style={styles.recovery}>
            <View style={styles.statusRow}>
              <AppIcon color={colors.danger} name="alert-circle-outline" size={22} />
              <View style={styles.statusCopy}>
                <Text style={styles.statusTitle}>这次整理还不完整</Text>
                <Text style={styles.statusText}>部分输入没有处理成功，系统没有静默忽略这些内容。</Text>
              </View>
            </View>
            <CapturePartStatuses parts={data?.parts ?? []} />
            <AppButton compact label="重新输入" onPress={onReenterCapture} variant="secondary" />
          </View>
        ) : phase === 'dismissed' ? (
          <View style={styles.recovery}>
            <Text style={styles.statusTitle}>这次没有保存内容</Text>
            <Text style={styles.statusText}>{data?.instruction_note ?? '这次整理已结束。'}</Text>
            <AppButton compact label="完成" onPress={() => onCompleted('这次没有保存内容')} />
          </View>
        ) : phase === 'completed' ? (
          <View style={styles.recovery}>
            <View style={styles.statusRow}>
              <AppIcon color={colors.primaryStrong} name="checkmark-circle-outline" size={22} />
              <View style={styles.statusCopy}>
                <Text style={styles.statusTitle}>这次内容已经保存</Text>
                <Text style={styles.statusText}>同一 revision 不会再次提交。</Text>
              </View>
            </View>
            <AppButton compact label="完成" onPress={() => onCompleted('这次内容已经保存')} />
          </View>
        ) : phase === 'unavailable' ? (
          <View style={styles.recovery}>
            <Text style={styles.statusTitle}>结果暂时未能显示</Text>
            <Text style={styles.statusText}>
              已提交的输入还在，请重新加载结果。
            </Text>
            <AppButton compact label="重新加载" onPress={() => void capture.refetch()} variant="secondary" />
          </View>
        ) : (
          <RecoveryState
            actionLabel={operation.isError ? '重新查询' : '重新输入'}
            copy={errorMessage(
              data?.error ?? operation.data?.data.error ?? operation.error,
              '输入仍保留在最近输入中，可以重新输入后再整理。',
            )}
            onAction={operation.isError
              ? () => {
                  void operation.refetch();
                  void capture.refetch();
                }
              : onReenterCapture}
            title="这次没能整理成功"
          />
        )}
      </AssistantRow>
      {phase !== 'completed' && phase !== 'dismissed' ? (
        <AppButton compact label="先放一放，继续聊" variant="text" disabled={saving || answerQuestion.isPending} onPress={onDefer} />
      ) : null}
    </View>
  );
}

export function CaptureQuestionPrompt({
  answer,
  error,
  onAnswerChange,
  onSubmit,
  question,
  submitting,
}: {
  answer: string;
  error: string | null;
  onAnswerChange: (value: string) => void;
  onSubmit: (value: string) => void | Promise<void>;
  question: CaptureQuestion;
  submitting: boolean;
}) {
  const canSubmit = Boolean(answer.trim()) && !submitting;
  return (
    <View style={styles.question}>
      <View style={styles.questionContext}>
        <AppIcon color={colors.primaryStrong} name="document-text-outline" size={17} />
        <Text style={styles.questionContextText}>
          {question.capture_summary ?? '刚才的一次输入'}
        </Text>
      </View>
      <Text style={styles.questionLabel}>还需要你确认一件事</Text>
      <Text style={styles.questionText}>{question.question}</Text>
      {(question.quick_answers?.length ?? 0) > 0 ? (
        <View style={styles.quickAnswers}>
          {question.quick_answers?.map((option) => (
            <Pressable
              accessibilityRole="button"
              disabled={submitting}
              key={option}
              onPress={() => void onSubmit(option)}
              style={({ pressed }) => [styles.quickAnswer, pressed && styles.pressed]}
            >
              <Text style={styles.quickAnswerText}>{option}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <TextInput
        accessibilityLabel="补充说明"
        editable={!submitting}
        multiline
        onChangeText={onAnswerChange}
        placeholder="输入你的说明"
        placeholderTextColor={colors.textTertiary}
        style={styles.answerInput}
        value={answer}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <AppButton
        compact
        disabled={!canSubmit}
        label={submitting ? '正在提交…' : '发送补充'}
        onPress={() => void onSubmit(answer)}
      />
    </View>
  );
}

function AssistantRow({ children }: { children: ReactNode }) {
  return (
    <View style={styles.assistantRow}>
      <View style={styles.assistantMark}><AiAssistantAvatar size={30} /></View>
      <View style={styles.assistantBubble}>{children}</View>
    </View>
  );
}

function RecoveryState({
  actionLabel,
  copy,
  onAction,
  title,
}: {
  actionLabel: string;
  copy: string;
  onAction: () => void;
  title: string;
}) {
  return (
    <View style={styles.recovery}>
      <View style={styles.statusRow}>
        <AppIcon color={colors.danger} name="alert-circle-outline" size={22} />
        <View style={styles.statusCopy}>
          <Text style={styles.statusTitle}>{title}</Text>
          <Text style={styles.statusText}>{copy}</Text>
        </View>
      </View>
      <AppButton compact label={actionLabel} onPress={onAction} variant="secondary" />
    </View>
  );
}

function SourceSummary({ candidate, parts }: { candidate: CaptureCandidate; parts: CapturePart[] }) {
  const sources = (candidate.source_refs ?? [])
    .map((source) => ({ part: parts.find((part) => part.id === source.part_id), source }))
    .filter((item): item is { part: CapturePart; source: CaptureSourceRef } => Boolean(item.part));
  if (sources.length === 0) return null;
  return (
    <View accessibilityLabel="候选来源" style={styles.sources}>
      {sources.slice(0, 3).map(({ part, source }, index) => (
        <View key={`${part.id}-${index}`} style={styles.sourceItem}>
          {part.kind === 'image' && part.media_url ? (
            <Image contentFit="cover" source={{ uri: part.media_url }} style={styles.sourceImage} />
          ) : (
            <View style={styles.sourceIcon}>
              <AppIcon
                color={colors.textSecondary}
                name={part.kind === 'audio' ? 'mic-outline' : 'document-text-outline'}
                size={15}
              />
            </View>
          )}
          <Text numberOfLines={1} style={styles.sourceText}>{sourceLabel(part, source)}</Text>
        </View>
      ))}
    </View>
  );
}

function CapturePartStatuses({ parts }: { parts: CapturePart[] }) {
  if (parts.length === 0) return null;
  const items = capturePartStatusItems(parts);
  return (
    <View style={styles.partStatuses}>
      {items.map((item) => {
        const failed = item.status === 'failed';
        const complete = item.status === 'succeeded' || item.status === 'ignored';
        return (
          <View key={item.key} style={styles.partStatus}>
            {complete ? (
              <AppIcon color={colors.primaryStrong} name="checkmark-circle-outline" size={17} />
            ) : failed ? (
              <AppIcon color={colors.danger} name="alert-circle-outline" size={17} />
            ) : (
              <ActivityIndicator color={colors.textSecondary} size="small" />
            )}
            <Text style={[styles.partStatusText, failed && styles.partStatusFailed]}>
              {capturePartStatusLabel(item)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function capturePartStatusLabel(item: ReturnType<typeof capturePartStatusItems>[number]): string {
  const status = item.status === 'succeeded'
    ? '已读取'
    : item.status === 'failed'
      ? (item.errorMessage ?? '处理失败')
      : item.status === 'ignored'
        ? '已按你的选择忽略'
        : '正在处理';
  return `${item.label} · ${status}`;
}

function sourceLabel(part: CapturePart, source: CaptureSourceRef): string {
  if (part.kind === 'image') return `图片 ${part.position + 1}`;
  if (part.kind === 'audio') {
    const start = Math.floor((source.audio_start_ms ?? 0) / 1_000);
    const end = Math.ceil((source.audio_end_ms ?? part.duration_ms ?? 0) / 1_000);
    return end > start ? `语音 ${start}–${end} 秒` : '语音输入';
  }
  const text = part.text?.trim() ?? '';
  const start = Math.max(0, source.text_start ?? 0);
  const end = Math.min(text.length, source.text_end ?? text.length);
  const excerpt = text.slice(start, end).trim() || text;
  return excerpt ? `“${excerpt}”` : '文字输入';
}

function sharesSource(left: CaptureSourceRef[] | undefined, right: CaptureSourceRef[]): boolean {
  const partIds = new Set(right.map((source) => source.part_id));
  return Boolean(left?.some((source) => partIds.has(source.part_id)));
}

type PendingTrackers = Record<string, NonNullable<CaptureDraftPayload['tracker']>>;

function candidateTitle(payload: CaptureDraftPayload, pending: PendingTrackers): string {
  if (payload.record) return `${pending[payload.record.tracker_ref ?? '']?.name ?? '数据'}记录`;
  return payload.task?.title
    ?? payload.event?.title
    ?? payload.project?.title
    ?? payload.tracker?.name
    ?? payload.note?.title
    ?? payload.note?.content
    ?? '未命名内容';
}

function candidateDetail(payload: CaptureDraftPayload, pending: PendingTrackers): string {
  if (payload.task?.due_at) return `截止 ${formatMinuteDateTime(payload.task.due_at)}`;
  if (payload.task?.due_date) return `截止 ${payload.task.due_date}`;
  if (payload.event?.start_at) return formatMinuteDateTime(payload.event.start_at, payload.event.timezone ?? undefined);
  if (payload.event?.start_date) return `${payload.event.start_date} · 全天`;
  if (payload.project?.destination) return payload.project.destination;
  if (payload.note) return payload.note.content;
  if (payload.tracker) return payload.tracker.fields.map((field) => `${field.label}${field.unit ? `（${field.unit}）` : ''}`).join('、');
  if (payload.record) {
    const fields = pending[payload.record.tracker_ref ?? '']?.fields ?? [];
    return payload.record.values.map((value) => {
      const field = fields.find((item) => item.key === value.key);
      return `${field?.label ?? '数值'}：${value.number_value ?? value.text_value ?? '待填写'}${field?.unit ? ` ${field.unit}` : ''}`;
    }).join('；');
  }
  return '';
}

function candidateMeta(candidate: CaptureCandidate, payload: CaptureDraftPayload): CandidateMeta {
  if (payload.project?.project_kind === 'trip') {
    return { label: '行程', icon: 'airplane-outline', color: '#187A75', soft: '#E9F7F5' };
  }
  if (payload.event?.itinerary_details?.kind === 'transport') {
    return { label: '交通', icon: 'train-outline', color: '#3978B8', soft: '#EAF4FF' };
  }
  if (payload.event?.itinerary_details?.kind === 'lodging') {
    return { label: '住宿', icon: 'bed-outline', color: '#7657C8', soft: '#F2EEFF' };
  }
  return typeMeta[candidate.candidate_type];
}

function missingFieldLabel(field: string): string {
  const labels: Record<string, string> = {
    title: '名称', content: '正文', name: '名称', destination: '目的地',
    start_date: '开始日期', target_date: '结束日期', due_date: '截止日期',
    due_at: '截止时间', start_at: '开始时间', end_at: '结束时间',
    timestamp: '发生时间', project_ref: '所属行程', tracker_ref: '记录项',
    fields: '字段结构', values: '记录值', amount: '金额', category: '分类',
    direction: '收支类型', location: '地点', date: '日期', time: '时间',
    'itinerary_details.kind': '安排类型',
    'itinerary_details.booking_status': '预订状态',
    'itinerary_details.transport_mode': '交通方式',
    'itinerary_details.origin': '出发地',
    'itinerary_details.destination': '到达地',
  };
  return labels[field] ?? field;
}

function saveHint(selected: number, blocked: number, conflicts: number): string | null {
  if (selected === 0) return '至少选择一项要保存的内容。';
  if (blocked > 0) return `已选内容中有 ${blocked} 项仍需补全。`;
  if (conflicts > 0) return `还需确认 ${conflicts} 处歧义信息。`;
  return null;
}

const styles = StyleSheet.create({
  flow: { gap: 14 },
  userRow: { alignItems: 'flex-end' },
  userBubble: {
    maxWidth: '84%', paddingHorizontal: 14, paddingVertical: 11,
    borderRadius: radius.lg, borderTopRightRadius: 7, backgroundColor: colors.primary,
  },
  userText: { color: colors.background, fontFamily, ...typography.body },
  assistantRow: { width: '100%', flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  assistantMark: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  assistantBubble: {
    minWidth: 0, flex: 1,
    padding: 14, borderRadius: radius.lg, borderTopLeftRadius: 7,
    backgroundColor: colors.surfaceSubtle,
  },
  statusRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  processingState: { gap: 12 },
  statusCopy: { minWidth: 0, flex: 1, gap: 3 },
  statusTitle: { color: colors.text, fontFamily, ...typography.bodyStrong },
  statusText: { color: colors.textSecondary, fontFamily, ...typography.meta },
  confirmation: { gap: 14 },
  conflicts: { gap: 9, padding: 12, borderRadius: radius.md, backgroundColor: colors.dangerSoft },
  warningTitle: { color: colors.danger, fontFamily, ...typography.bodyStrong },
  conflictItem: { gap: 7 },
  conflictLabel: { color: colors.text, fontFamily, ...typography.meta, fontWeight: '600' },
  option: {
    minHeight: 44, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  optionSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  optionText: { minWidth: 0, flex: 1, color: colors.text, fontFamily, ...typography.meta },
  candidates: {
    overflow: 'hidden', borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, backgroundColor: colors.background,
  },
  candidate: { paddingHorizontal: 14, paddingVertical: 14 },
  candidateDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  candidateHead: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12,
  },
  candidateIdentity: { minWidth: 0, flex: 1, gap: 8 },
  typeChip: {
    alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, flexDirection: 'row',
    alignItems: 'center', gap: 4, borderRadius: radius.pill,
  },
  typeText: { fontFamily, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  checkbox: {
    width: 44, height: 44, marginTop: -5, marginRight: -7,
    alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill,
  },
  checkboxIndicator: {
    width: 26, height: 26, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: colors.borderStrong, borderRadius: radius.pill,
    backgroundColor: colors.background,
  },
  checkboxIndicatorSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  candidateTitle: { color: colors.text, fontFamily, ...typography.section },
  candidateDetail: { marginTop: 8, color: colors.textSecondary, fontFamily, ...typography.meta },
  sources: { marginTop: 9, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sourceItem: {
    maxWidth: '100%', height: 34, paddingRight: 8, flexDirection: 'row',
    alignItems: 'center', gap: 6, overflow: 'hidden', borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  sourceImage: { width: 36, height: 34, backgroundColor: colors.surface },
  sourceIcon: { width: 32, height: 34, alignItems: 'center', justifyContent: 'center' },
  sourceText: { maxWidth: 170, color: colors.textSecondary, fontFamily, ...typography.caption },
  warning: { marginTop: 6, color: '#815000', fontFamily, ...typography.meta },
  error: { marginTop: 6, color: colors.danger, fontFamily, ...typography.meta },
  editButton: {
    minWidth: 96, marginTop: 10, alignSelf: 'flex-start',
  },
  saveArea: { gap: 8 },
  saveHint: { color: colors.textSecondary, fontFamily, ...typography.meta },
  confirmationActions: { flexDirection: 'row', gap: 10 },
  confirmationAction: { minWidth: 0, flex: 1 },
  emptyResult: { gap: 10 },
  recovery: { gap: 12 },
  partStatuses: { gap: 7 },
  partStatus: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 7 },
  partStatusText: { minWidth: 0, flex: 1, color: colors.textSecondary, fontFamily, ...typography.meta },
  partStatusFailed: { color: colors.danger },
  question: { gap: 11 },
  questionContext: {
    minHeight: 44, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7,
    borderRadius: radius.md, backgroundColor: colors.primarySoft,
  },
  questionContextText: { minWidth: 0, flex: 1, color: colors.primaryStrong, fontFamily, ...typography.meta },
  questionLabel: { color: '#815000', fontFamily, ...typography.meta, fontWeight: '700' },
  questionText: { color: colors.text, fontFamily, fontSize: 18, lineHeight: 27, fontWeight: '600' },
  quickAnswers: { gap: 7 },
  quickAnswer: {
    minHeight: 44, paddingHorizontal: 12, justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  quickAnswerText: { color: colors.text, fontFamily, ...typography.body },
  answerInput: {
    minHeight: 52, maxHeight: 112, paddingHorizontal: 12, paddingVertical: 11,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    color: colors.text, fontFamily, ...typography.body, backgroundColor: colors.background,
  },
  pressed: { opacity: 0.7 },
});
