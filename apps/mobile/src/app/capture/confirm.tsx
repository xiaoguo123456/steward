import {
  confirmCapture,
  errorMessage,
  useGetCapture,
  type CaptureCandidate,
  type ConfirmCaptureItem,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { SectionTitle } from '@/components/ui/section-title';
import { StatePanel } from '@/components/ui/state-panel';
import { formatMonthDay } from '@/utils/format';
import { formatTripDate } from '@/features/trips/trip-form';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

/** 候选类型的展示信息。 */
type CandidateMeta = {
  label: string;
  icon: React.ComponentProps<typeof AppIcon>['name'];
  color: string;
  soft: string;
};

const typeMeta: Record<
  CaptureCandidate['candidate_type'],
  CandidateMeta
> = {
  task: { label: '任务', icon: 'checkmark-circle-outline', color: colors.primaryStrong, soft: colors.primarySoft },
  event: { label: '日程', icon: 'calendar-outline', color: '#3978B8', soft: '#EAF4FF' },
  note: { label: '笔记', icon: 'document-text-outline', color: '#7657C8', soft: '#F2EEFF' },
  project: { label: '项目', icon: 'flag-outline', color: '#187A75', soft: '#E9F7F5' },
  tracker: { label: '记录项', icon: 'stats-chart-outline', color: '#D56C28', soft: '#FFF1E7' },
  record: { label: '记录', icon: 'analytics-outline', color: '#C04C81', soft: '#FDEEF5' },
};

export default function CaptureConfirmScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ captureId?: string; intent?: string; projectId?: string }>();
  const captureId = params.captureId ?? '';
  const isTripIntent = params.intent === 'trip';
  const isTripItemIntent = params.intent === 'trip_item';
  const pageTitle = isTripIntent ? '确认行程' : isTripItemIntent ? '确认行程安排' : '确认整理结果';

  const capture = useGetCapture(captureId, { query: { enabled: Boolean(captureId) } });
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const data = capture.data?.data;
  const candidates = useMemo(() => data?.candidates ?? [], [data]);

  // 服务端给出默认勾选状态；用户取消的项记在 excluded 里。
  const isSelected = (candidate: CaptureCandidate) =>
    candidate.selected && !excluded.has(candidate.id);

  const selectedCandidates = candidates.filter(isSelected);
  const blockedCount = candidates.filter((c) => (c.missing_fields?.length ?? 0) > 0).length;

  const toggle = (candidate: CaptureCandidate) => {
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(candidate.id)) next.delete(candidate.id);
      else next.add(candidate.id);
      return next;
    });
  };

  const save = async () => {
    if (!data || selectedCandidates.length === 0 || saving) return;
    setSaveError(null);
    setSaving(true);
    try {
      const items: ConfirmCaptureItem[] = selectedCandidates.map((candidate) => ({
        candidate_id: candidate.id,
      }));
      const response = await confirmCapture(captureId, { revision: data.revision, items });
      // 保存成功后让全部服务端事实失效，Today 与各列表会拉到新内容。
      await queryClient.invalidateQueries();
      if (isTripIntent) {
        const project = response.data.affected_resources.find(
          (resource) => resource.type === 'project' && resource.id,
        );
        if (project?.id) {
          router.replace({ pathname: '/trips/[id]', params: { id: project.id } });
        } else {
          router.replace('/trips');
        }
      } else if (isTripItemIntent && params.projectId) {
        router.replace({ pathname: '/trips/[id]', params: { id: params.projectId } });
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
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
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
            <Text style={styles.conflictTitle}>需要你确认</Text>
            {data.conflicts?.map((conflict) => (
              <Text key={conflict.id} style={styles.conflictText}>
                {conflict.description ?? `${conflict.field} 存在多个取值`}：
                {conflict.options.map((option) => option.value).join(' / ')}
              </Text>
            ))}
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
          candidates.map((candidate) => {
            const meta = candidateMeta(candidate);
            const selected = isSelected(candidate);
            const missing = candidate.missing_fields ?? [];
            return (
              <Pressable
                accessibilityLabel={`${selected ? '取消选择' : '选择'}${meta.label}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                key={candidate.id}
                onPress={() => toggle(candidate)}
                style={({ pressed }) => [
                  styles.card,
                  selected && styles.cardSelected,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.cardHead}>
                  <View style={[styles.typeChip, { backgroundColor: meta.soft }]}>
                    <AppIcon color={meta.color} name={meta.icon} size={14} />
                    <Text style={[styles.typeChipText, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                  <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
                    {selected ? (
                      <AppIcon color={colors.background} name="checkmark" size={14} />
                    ) : null}
                  </View>
                </View>

                <Text style={styles.cardTitle}>{candidateTitle(candidate)}</Text>
                {candidateDetail(candidate) ? (
                  <Text style={styles.cardDetail}>{candidateDetail(candidate)}</Text>
                ) : null}

                {missing.length > 0 ? (
                  <Text style={styles.missing}>
                    还需补全：{missing.map(missingFieldLabel).join('、')}
                  </Text>
                ) : null}
                {(candidate.warnings?.length ?? 0) > 0 ? (
                  <Text style={styles.warning}>{candidate.warnings?.join('；')}</Text>
                ) : null}
              </Pressable>
            );
          })
        )}

        {saveError ? <Text style={styles.error}>{saveError}</Text> : null}
      </ScrollView>

      {candidates.length > 0 ? (
        <View style={styles.footer}>
          {blockedCount > 0 ? (
            <Text style={styles.footerHint}>有 {blockedCount} 项缺少必填信息，暂时不能保存。</Text>
          ) : null}
          <Pressable
            accessibilityLabel={`保存 ${selectedCandidates.length} 项`}
            accessibilityRole="button"
            accessibilityState={{ disabled: selectedCandidates.length === 0 || saving }}
            disabled={selectedCandidates.length === 0 || saving}
            onPress={() => void save()}
            style={({ pressed }) => [
              styles.saveButton,
              (selectedCandidates.length === 0 || saving) && styles.saveDisabled,
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
                  : `保存 ${selectedCandidates.length} 项`}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </AppScreen>
  );
}

/** 从判别联合快照里取出标题。 */
function candidateTitle(candidate: CaptureCandidate): string {
  const p = candidate.payload;
  return (
    p.task?.title ??
    p.event?.title ??
    p.project?.title ??
    p.tracker?.name ??
    p.note?.title ??
    p.note?.content ??
    '未命名内容'
  );
}

/** 生成一行时间或内容摘要。 */
function candidateDetail(candidate: CaptureCandidate): string {
  const p = candidate.payload;
  if (p.task) {
    if (p.task.due_at) return `截止 ${new Date(p.task.due_at).toLocaleString('zh-CN')}`;
    if (p.task.due_date) return `${formatMonthDay(p.task.due_date)}截止`;
    return '没有截止时间';
  }
  if (p.event) {
    if (p.event.itinerary_details?.kind === 'transport') {
      const details = p.event.itinerary_details;
      const route = details.origin && details.destination
        ? `${details.origin} — ${details.destination}`
        : '';
      const time = p.event.start_at
        ? new Date(p.event.start_at).toLocaleString('zh-CN')
        : '';
      return [details.service_number, route, time].filter(Boolean).join(' · ');
    }
    if (p.event.itinerary_details?.kind === 'lodging') {
      return [p.event.location, p.event.start_at ? new Date(p.event.start_at).toLocaleString('zh-CN') : '']
        .filter(Boolean)
        .join(' · ');
    }
    if (p.event.start_at) return new Date(p.event.start_at).toLocaleString('zh-CN');
    if (p.event.start_date) return `${formatMonthDay(p.event.start_date)} · 全天`;
    return '';
  }
  if (p.note) return p.note.content;
  if (p.project) {
    const lines: string[] = [];
    if (p.project.destination) lines.push(p.project.destination);
    if (p.project.start_date && p.project.target_date) {
      lines.push(`${formatTripDate(p.project.start_date)} 至 ${formatTripDate(p.project.target_date)}`);
    } else if (p.project.start_date) {
      lines.push(`开始于 ${formatTripDate(p.project.start_date)}`);
    }
    if (p.project.description) lines.push(p.project.description);
    return lines.join('\n');
  }
  if (p.record) return `${p.record.values.length} 个字段`;
  return '';
}

function candidateMeta(candidate: CaptureCandidate): CandidateMeta {
  if (candidate.payload.project?.project_kind === 'trip') {
    return {
      label: '行程',
      icon: 'airplane-outline',
      color: '#187A75',
      soft: '#E9F7F5',
    };
  }
  if (candidate.payload.event?.itinerary_details?.kind === 'transport') {
    return { label: '交通', icon: 'train-outline', color: '#3978B8', soft: '#EAF4FF' };
  }
  if (candidate.payload.event?.itinerary_details?.kind === 'lodging') {
    return { label: '住宿', icon: 'bed-outline', color: '#7657C8', soft: '#F2EEFF' };
  }
  if (candidate.payload.event?.itinerary_details?.kind === 'activity') {
    return { label: '活动', icon: 'ticket-outline', color: '#D56C28', soft: '#FFF1E7' };
  }
  return typeMeta[candidate.candidate_type];
}

function missingFieldLabel(field: string): string {
  return {
    title: '名称',
    destination: '目的地',
    start_date: '开始日期',
    target_date: '结束日期',
    project_ref: '所属行程',
    end_at: '结束时间',
    location: '地点',
    'itinerary_details.kind': '安排类型',
    'itinerary_details.booking_status': '预订状态',
    'itinerary_details.transport_mode': '交通方式',
    'itinerary_details.origin': '出发地',
    'itinerary_details.destination': '到达地',
  }[field] ?? field;
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
  },
  conflictTitle: {
    color: colors.danger,
    fontFamily,
    ...typography.bodyStrong,
  },
  conflictText: {
    marginTop: 4,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  card: {
    marginBottom: 10,
    padding: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  cardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  pressed: {
    opacity: 0.75,
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
    width: 22,
    height: 22,
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
    marginTop: 8,
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
  missing: {
    marginTop: 6,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  warning: {
    marginTop: 6,
    color: colors.warning,
    fontFamily,
    ...typography.meta,
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
