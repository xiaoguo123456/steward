import {
  confirmCapture,
  errorMessage,
  undoActivityBatch,
  useGetCapture,
  type CaptureCandidate,
  type CaptureConflict,
  type CaptureDraftPayload,
  type CapturePart,
  type CaptureSourceRef,
  type ConfirmCaptureItem,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { SectionTitle } from '@/components/ui/section-title';
import { StatePanel } from '@/components/ui/state-panel';
import { useToast } from '@/components/ui/toast';
import { CaptureCandidateEditor } from '@/features/capture/capture-candidate-editor';
import {
  applyConflictChoice,
  cloneCapturePayload,
  unresolvedCandidateFields,
} from '@/features/capture/capture-confirmation-model';
import { summarizeCaptureResources } from '@/features/capture/capture-success-model';
import { formatTripDate } from '@/features/trips/trip-form';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';
import { formatMonthDay } from '@/utils/format';

type CandidateMeta = {
  label: string;
  icon: ComponentProps<typeof AppIcon>['name'];
  color: string;
  soft: string;
};

const typeMeta: Record<CaptureCandidate['candidate_type'], CandidateMeta> = {
  task: {
    label: '任务',
    icon: 'checkmark-circle-outline',
    color: colors.primaryStrong,
    soft: colors.primarySoft,
  },
  event: { label: '日程', icon: 'calendar-outline', color: '#3978B8', soft: '#EAF4FF' },
  note: { label: '笔记', icon: 'document-text-outline', color: '#7657C8', soft: '#F2EEFF' },
  project: { label: '项目', icon: 'flag-outline', color: '#187A75', soft: '#E9F7F5' },
  tracker: { label: '记录项', icon: 'stats-chart-outline', color: '#D56C28', soft: '#FFF1E7' },
  record: { label: '记录', icon: 'analytics-outline', color: '#C04C81', soft: '#FDEEF5' },
};

export default function CaptureConfirmScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const params = useLocalSearchParams<{ captureId?: string; intent?: string; projectId?: string }>();
  const captureId = params.captureId ?? '';
  const isTripIntent = params.intent === 'trip';
  const isTripItemIntent = params.intent === 'trip_item';
  const isLedgerIntent = params.intent === 'ledger';
  const pageTitle = isTripIntent
    ? '确认行程'
    : isTripItemIntent
      ? '确认行程安排'
      : isLedgerIntent
        ? '确认账单'
        : '确认整理结果';

  const capture = useGetCapture(captureId, { query: { enabled: Boolean(captureId) } });
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, CaptureDraftPayload>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [conflictChoices, setConflictChoices] = useState<Record<string, string>>({});
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const data = capture.data?.data;
  const candidates = useMemo(() => data?.candidates ?? [], [data]);

  const isSelected = (candidate: CaptureCandidate) =>
    selection[candidate.id] ?? candidate.selected;
  const draftFor = (candidate: CaptureCandidate) => drafts[candidate.id] ?? candidate.payload;
  const selectedCandidates = candidates.filter(isSelected);
  const blockedCandidates = selectedCandidates.filter(
    (candidate) => unresolvedCandidateFields(candidate, draftFor(candidate)).length > 0,
  );
  const unresolvedConflictCount = (data?.conflicts ?? []).filter(
    (conflict) => !conflictChoices[conflict.id],
  ).length;
  const canSave = selectedCandidates.length > 0
    && blockedCandidates.length === 0
    && unresolvedConflictCount === 0
    && !saving;

  const toggle = (candidate: CaptureCandidate) => {
    setSelection((current) => ({
      ...current,
      [candidate.id]: !(current[candidate.id] ?? candidate.selected),
    }));
  };

  const chooseConflict = (conflict: CaptureConflict, value: string, refs: CaptureSourceRef[]) => {
    const orderedCandidates = [...candidates].sort((left, right) => {
      const leftMatch = sharesSource(left.source_refs, refs) ? 1 : 0;
      const rightMatch = sharesSource(right.source_refs, refs) ? 1 : 0;
      return rightMatch - leftMatch;
    });

    for (const candidate of orderedCandidates) {
      const currentDraft = draftFor(candidate);
      const result = applyConflictChoice(
        currentDraft,
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

    setConflictError(`“${conflict.description ?? conflict.field}”无法对应到可编辑字段，请返回补充说明后重新整理。`);
  };

  const save = async () => {
    if (!data || !canSave) return;
    setSaveError(null);
    setSaving(true);
    try {
      const items: ConfirmCaptureItem[] = selectedCandidates.map((candidate) => ({
        candidate_id: candidate.id,
        payload: cloneCapturePayload(draftFor(candidate)),
      }));
      const response = await confirmCapture(captureId, { revision: data.revision, items });
      await queryClient.invalidateQueries();
      const project = response.data.affected_resources.find(
        (resource) => resource.type === 'project' && resource.id,
      );
      const summary = summarizeCaptureResources(
        response.data.affected_resources,
        selectedCandidates.length,
      );
      const activityBatchId = response.data.capture.activity_batch_id;
      showToast(`${summary.text}已保存`, activityBatchId ? {
        actionLabel: '撤销',
        durationMs: 10_000,
        onAction: async () => {
          try {
            await undoActivityBatch(activityBatchId);
            await queryClient.invalidateQueries();
            showToast('本次保存已撤销');
            if (isTripIntent) router.replace('/trips');
          } catch (error) {
            showToast(errorMessage(error, '暂时无法撤销，请稍后重试。'));
          }
        },
      } : undefined);
      if (isTripIntent) {
        if (project?.id) {
          router.replace({ pathname: '/trips/[id]', params: { id: project.id } });
        } else {
          router.replace('/trips');
        }
      } else if (isTripItemIntent && params.projectId) {
        router.replace({ pathname: '/trips/[id]', params: { id: params.projectId } });
      } else if (isLedgerIntent) {
        router.replace({ pathname: '/features/[slug]', params: { slug: 'ledger' } });
      } else {
        router.replace('/today');
      }
    } catch (error) {
      setSaveError(errorMessage(error, '保存失败，请稍后重试。'));
    } finally {
      setSaving(false);
    }
  };

  if (capture.isPending) {
    return (
      <AppScreen includeBottomInset>
        <NavHeader title={pageTitle} />
        <CaptureConfirmSkeleton />
      </AppScreen>
    );
  }

  if (capture.isError || !data) {
    return (
      <AppScreen includeBottomInset>
        <NavHeader title={pageTitle} />
        <View style={styles.content}>
          <StatePanel
            actionLabel="重试"
            icon="cloud-offline-outline"
            message={errorMessage(capture.error, '暂时无法加载整理结果。')}
            onAction={() => void capture.refetch()}
            title="加载失败"
          />
        </View>
      </AppScreen>
    );
  }

  return (
    <AppScreen includeBottomInset>
      <NavHeader title={pageTitle} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {data.instruction_note ? (
          <View style={styles.instruction}>
            <AppIcon color={colors.warning} name="information-circle-outline" size={18} />
            <Text style={styles.instructionText}>你要求：{data.instruction_note}</Text>
          </View>
        ) : null}

        {(data.conflicts?.length ?? 0) > 0 ? (
          <View style={styles.conflictBox}>
            <View style={styles.conflictHeader}>
              <AppIcon color={colors.danger} name="alert-circle-outline" size={18} />
              <Text style={styles.conflictTitle}>先确认有歧义的信息</Text>
            </View>
            {data.conflicts?.map((conflict) => (
              <View key={conflict.id} style={styles.conflictItem}>
                <Text style={styles.conflictDescription}>
                  {conflict.description ?? `${missingFieldLabel(conflict.field)}存在多个取值`}
                </Text>
                <View accessibilityRole="radiogroup" style={styles.conflictOptions}>
                  {conflict.options.map((option) => {
                    const selected = conflictChoices[conflict.id] === option.value;
                    return (
                      <Pressable
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected }}
                        key={option.value}
                        onPress={() => chooseConflict(conflict, option.value, option.source_refs)}
                        style={({ pressed }) => [
                          styles.conflictOption,
                          selected && styles.conflictOptionSelected,
                          pressed && styles.pressed,
                        ]}
                      >
                        <View style={[styles.radio, selected && styles.radioSelected]}>
                          {selected ? <View style={styles.radioDot} /> : null}
                        </View>
                        <Text style={styles.conflictOptionText}>{option.value}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
            {conflictError ? <Text style={styles.conflictError}>{conflictError}</Text> : null}
          </View>
        ) : null}

        <SectionTitle count={`${candidates.length} 项`} title="整理结果" />

        {candidates.length === 0 ? (
          <StatePanel
            actionLabel="重新输入"
            icon="sparkles-outline"
            message="这次没有识别出可以保存的内容，换个说法再试试。"
            onAction={() => router.replace({
              pathname: '/capture/new',
              params: { intent: params.intent, projectId: params.projectId },
            })}
            title="没有候选结果"
          />
        ) : (
          <View style={styles.candidateGroup}>
            {candidates.map((candidate, index) => {
              const draft = draftFor(candidate);
              const meta = candidateMeta(candidate, draft);
              const selected = isSelected(candidate);
              const missing = unresolvedCandidateFields(candidate, draft);
              const lowConfidence = candidate.field_confidences
                ?.filter((field) => field.level === 'low')
                .map((field) => missingFieldLabel(field.field)) ?? [];
              const editing = editingId === candidate.id;
              return (
                <View
                  key={candidate.id}
                  style={[
                    styles.candidateRow,
                    index > 0 && styles.candidateDivider,
                    selected && styles.candidateRowSelected,
                  ]}
                >
                  <View style={styles.cardHead}>
                    <View style={[styles.typeChip, { backgroundColor: meta.soft }]}>
                      <AppIcon color={meta.color} name={meta.icon} size={14} />
                      <Text style={[styles.typeChipText, { color: meta.color }]}>{meta.label}</Text>
                    </View>
                    <Pressable
                      accessibilityLabel={`${selected ? '取消选择' : '选择'}${meta.label}`}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                      hitSlop={8}
                      onPress={() => toggle(candidate)}
                      style={({ pressed }) => [
                        styles.checkbox,
                        selected && styles.checkboxSelected,
                        pressed && styles.pressed,
                      ]}
                    >
                      {selected ? <AppIcon color={colors.background} name="checkmark" size={14} /> : null}
                    </Pressable>
                  </View>

                  <Text style={styles.cardTitle}>{candidateTitle(draft)}</Text>
                  {candidateDetail(draft) ? (
                    <Text style={styles.cardDetail}>{candidateDetail(draft)}</Text>
                  ) : null}

                  <SourceSummary candidate={candidate} parts={data.parts} />

                  {missing.length > 0 ? (
                    <Text style={styles.missing}>还需补全：{missing.map(missingFieldLabel).join('、')}</Text>
                  ) : null}
                  {lowConfidence.length > 0 ? (
                    <Text style={styles.warning}>请重点核对：{lowConfidence.join('、')}</Text>
                  ) : null}
                  {candidate.duplicate_of ? (
                    <Text style={styles.warning}>可能与已有内容重复，保存前请核对。</Text>
                  ) : null}
                  {(candidate.warnings?.length ?? 0) > 0 ? (
                    <Text style={styles.warning}>{candidate.warnings?.join('；')}</Text>
                  ) : null}

                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setEditingId(editing ? null : candidate.id)}
                    style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}
                  >
                    <AppIcon color={colors.primaryStrong} name={editing ? 'chevron-up' : 'create-outline'} size={16} />
                    <Text style={styles.editButtonText}>{editing ? '收起编辑' : '检查并编辑'}</Text>
                  </Pressable>

                  {editing ? (
                    <CaptureCandidateEditor
                      candidate={candidate}
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

        {saveError ? <Text style={styles.error}>{saveError}</Text> : null}
      </ScrollView>

      {candidates.length > 0 ? (
        <View style={styles.footer}>
          <Text style={styles.footerHint}>{footerHint(
            selectedCandidates.length,
            blockedCandidates.length,
            unresolvedConflictCount,
          )}</Text>
          <Pressable
            accessibilityLabel={`保存 ${selectedCandidates.length} 项`}
            accessibilityHint={canSave ? '保存当前勾选并核对后的内容' : footerHint(
              selectedCandidates.length,
              blockedCandidates.length,
              unresolvedConflictCount,
            )}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSave }}
            disabled={!canSave}
            onPress={() => void save()}
            style={({ pressed }) => [
              styles.saveButton,
              !canSave && styles.saveDisabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.saveText}>
              {saving
                ? '保存中…'
                : isTripIntent && selectedCandidates.length === 1
                  ? '创建行程'
                  : isTripItemIntent
                    ? '保存行程安排'
                    : isLedgerIntent
                      ? '保存账单'
                      : `保存 ${selectedCandidates.length} 项`}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </AppScreen>
  );
}

function CaptureConfirmSkeleton() {
  return (
    <View accessibilityLabel="正在加载整理结果" style={styles.skeletonContent}>
      <View style={[styles.skeleton, styles.skeletonNotice]} />
      <View style={[styles.skeleton, styles.skeletonSection]} />
      <View style={styles.skeletonGroup}>
        {[0, 1, 2].map((item) => (
          <View key={item} style={styles.skeletonRow}>
            <View style={[styles.skeleton, styles.skeletonChip]} />
            <View style={[styles.skeleton, styles.skeletonTitle]} />
            <View style={[styles.skeleton, styles.skeletonText]} />
          </View>
        ))}
      </View>
    </View>
  );
}

function SourceSummary({
  candidate,
  parts,
}: {
  candidate: CaptureCandidate;
  parts: CapturePart[];
}) {
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

function sourceLabel(part: CapturePart, source: CaptureSourceRef): string {
  if (part.kind === 'image') return `图片 ${part.position + 1}`;
  if (part.kind === 'audio') {
    const start = Math.floor((source.audio_start_ms ?? 0) / 1000);
    const end = Math.ceil((source.audio_end_ms ?? part.duration_ms ?? 0) / 1000);
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

function footerHint(selected: number, blocked: number, conflicts: number): string {
  if (selected === 0) return '至少选择一项要保存的内容。';
  if (blocked > 0) return `已选内容中有 ${blocked} 项仍需补全。`;
  if (conflicts > 0) return `还需确认 ${conflicts} 处歧义信息。`;
  return `已核对 ${selected} 项，保存后仍可在对应页面修改。`;
}

function candidateTitle(payload: CaptureDraftPayload): string {
  return (
    payload.task?.title
    ?? payload.event?.title
    ?? payload.project?.title
    ?? payload.tracker?.name
    ?? payload.note?.title
    ?? payload.note?.content
    ?? '未命名内容'
  );
}

function candidateDetail(payload: CaptureDraftPayload): string {
  if (payload.task) {
    if (payload.task.due_at) return `截止 ${new Date(payload.task.due_at).toLocaleString('zh-CN')}`;
    if (payload.task.due_date) return `${formatMonthDay(payload.task.due_date)}截止`;
    return '没有截止时间';
  }
  if (payload.event) {
    if (payload.event.itinerary_details?.kind === 'transport') {
      const details = payload.event.itinerary_details;
      const route = details.origin && details.destination
        ? `${details.origin} — ${details.destination}`
        : '';
      const time = payload.event.start_at
        ? new Date(payload.event.start_at).toLocaleString('zh-CN')
        : '';
      return [details.service_number, route, time].filter(Boolean).join(' · ');
    }
    if (payload.event.itinerary_details?.kind === 'lodging') {
      return [
        payload.event.location,
        payload.event.start_at ? new Date(payload.event.start_at).toLocaleString('zh-CN') : '',
      ].filter(Boolean).join(' · ');
    }
    if (payload.event.start_at) return new Date(payload.event.start_at).toLocaleString('zh-CN');
    if (payload.event.start_date) return `${formatMonthDay(payload.event.start_date)} · 全天`;
    return '';
  }
  if (payload.note) return payload.note.content;
  if (payload.project) {
    const lines: string[] = [];
    if (payload.project.destination) lines.push(payload.project.destination);
    if (payload.project.start_date && payload.project.target_date) {
      lines.push(`${formatTripDate(payload.project.start_date)} 至 ${formatTripDate(payload.project.target_date)}`);
    } else if (payload.project.start_date) {
      lines.push(`开始于 ${formatTripDate(payload.project.start_date)}`);
    }
    if (payload.project.description) lines.push(payload.project.description);
    return lines.join('\n');
  }
  if (payload.record) return `${payload.record.values.length} 个字段`;
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
  if (payload.event?.itinerary_details?.kind === 'activity') {
    return { label: '活动', icon: 'ticket-outline', color: '#D56C28', soft: '#FFF1E7' };
  }
  return typeMeta[candidate.candidate_type];
}

function missingFieldLabel(field: string): string {
  const labels: Record<string, string> = {
    title: '名称',
    content: '正文',
    name: '名称',
    destination: '目的地',
    start_date: '开始日期',
    target_date: '结束日期',
    due_date: '截止日期',
    due_at: '截止时间',
    start_at: '开始时间',
    end_at: '结束时间',
    timestamp: '发生时间',
    project_ref: '所属行程',
    tracker_ref: '记录项',
    fields: '字段结构',
    values: '记录值',
    amount: '金额',
    category: '分类',
    direction: '收支类型',
    location: '地点',
    date: '日期',
    time: '时间',
    'itinerary_details.kind': '安排类型',
    'itinerary_details.booking_status': '预订状态',
    'itinerary_details.transport_mode': '交通方式',
    'itinerary_details.origin': '出发地',
    'itinerary_details.destination': '到达地',
  };
  return labels[field] ?? field;
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 132,
  },
  skeletonContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  skeleton: {
    overflow: 'hidden',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  skeletonNotice: {
    height: 48,
  },
  skeletonSection: {
    width: 132,
    height: 22,
    marginTop: 26,
    marginBottom: 14,
  },
  skeletonGroup: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
  },
  skeletonRow: {
    height: 126,
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  skeletonChip: {
    width: 66,
    height: 22,
  },
  skeletonTitle: {
    width: '68%',
    height: 20,
    marginTop: 14,
  },
  skeletonText: {
    width: '42%',
    height: 14,
    marginTop: 10,
  },
  instruction: {
    marginTop: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: radius.md,
    backgroundColor: '#FFF7E8',
  },
  instructionText: {
    flex: 1,
    color: '#8A5A00',
    fontFamily,
    ...typography.meta,
  },
  conflictBox: {
    marginTop: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#F2CDD3',
    borderRadius: radius.lg,
    backgroundColor: colors.dangerSoft,
  },
  conflictHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  conflictTitle: {
    color: colors.danger,
    fontFamily,
    ...typography.bodyStrong,
  },
  conflictItem: {
    marginTop: 14,
  },
  conflictDescription: {
    color: colors.text,
    fontFamily,
    ...typography.meta,
    fontWeight: '600',
  },
  conflictOptions: {
    marginTop: 8,
    gap: 7,
  },
  conflictOption: {
    minHeight: 44,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  conflictOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  radio: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
  },
  radioSelected: {
    borderColor: colors.primary,
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  conflictOptionText: {
    flex: 1,
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  conflictError: {
    marginTop: 10,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  candidateGroup: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  },
  candidateRow: {
    padding: 16,
  },
  candidateDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  candidateRowSelected: {
    backgroundColor: '#FBFEFC',
  },
  pressed: {
    opacity: 0.72,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  typeChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
  },
  typeChipText: {
    fontFamily,
    fontSize: 12,
    fontWeight: '600',
  },
  checkbox: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  checkboxSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  cardTitle: {
    marginTop: 10,
    color: colors.text,
    fontFamily,
    ...typography.bodyStrong,
  },
  cardDetail: {
    marginTop: 4,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  sources: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  sourceItem: {
    maxWidth: '100%',
    height: 34,
    paddingRight: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    overflow: 'hidden',
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  sourceImage: {
    width: 38,
    height: 34,
    backgroundColor: colors.surface,
  },
  sourceIcon: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceText: {
    maxWidth: 190,
    color: colors.textSecondary,
    fontFamily,
    ...typography.caption,
  },
  missing: {
    marginTop: 8,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  warning: {
    marginTop: 6,
    color: '#8A5A00',
    fontFamily,
    ...typography.meta,
  },
  editButton: {
    minHeight: 44,
    marginTop: 12,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  editButtonText: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.meta,
    fontWeight: '600',
  },
  error: {
    marginTop: 12,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  footerHint: {
    marginBottom: 8,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  saveButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  saveDisabled: {
    backgroundColor: colors.borderStrong,
  },
  saveText: {
    color: colors.background,
    fontFamily,
    fontSize: 16,
    fontWeight: '600',
  },
});
