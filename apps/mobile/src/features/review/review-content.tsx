import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter, type Href } from 'expo-router';

import { ProposalCard } from '@/features/assistant/proposal-card';
import {
  recentCompletedPeriods,
  type ReviewPeriod,
} from '@/features/review/review-period';
import { groupReviewMetrics } from '@/features/review/review-metrics';
import {
  formatDelta,
  formatMetric,
  useWeeklyReview,
} from '@/features/review/use-weekly-review';
import { formatRelativeTime } from '@/utils/format';

import { AiAssistantAvatar } from '@/components/ui/ai-assistant-avatar';
import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/icon';
import { ModalSheet } from '@/components/ui/modal-sheet';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

/** 来源引用。资源类型决定点进去看哪一页。 */
type ReviewSourceLink = {
  label: string;
  resourceType: string;
  resourceId: string;
};

/** 来源类型 → 可以跳过去的页面。认不出的类型不给链接，不瞎猜。 */
function routeForSource(source: ReviewSourceLink): Href | null {
  switch (source.resourceType) {
    case 'task':
      return '/lists';
    case 'event':
      return '/calendar';
    case 'record':
    case 'tracker':
      return '/data';
    case 'note':
      return { pathname: '/notes/[id]', params: { id: source.resourceId } };
    default:
      return null;
  }
}

function ReviewSectionHeader({ title }: { title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
    </View>
  );
}

function SourceLink({ source }: { source: ReviewSourceLink }) {
  const router = useRouter();
  const route = routeForSource(source);

  // 认不出的资源类型只展示名字，不给一个点了没反应的箭头。
  if (!route) {
    return (
      <View style={styles.sourceLink}>
        <AppIcon color={colors.textSecondary} name="document-text-outline" size={16} />
        <Text style={styles.sourceLinkText}>{source.label}</Text>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityLabel={`${source.label}，查看来源`}
      accessibilityRole="link"
      onPress={() => router.push(route)}
      style={({ pressed }) => [styles.sourceLink, pressed && styles.pressed]}
    >
      <AppIcon color={colors.textSecondary} name="document-text-outline" size={16} />
      <Text style={styles.sourceLinkText}>{source.label}</Text>
      <AppIcon color={colors.borderStrong} name="chevron-forward" size={15} />
    </Pressable>
  );
}

function ReviewPeriodPickerSheet({
  periods,
  currentIndex,
  onClose,
  onSelect,
  visible,
}: {
  periods: ReviewPeriod[];
  currentIndex: number;
  onClose: () => void;
  onSelect: (index: number) => void;
  visible: boolean;
}) {
  if (!visible) return null;

  return (
    <Modal animationType="fade" onRequestClose={onClose} statusBarTranslucent transparent visible>
      <ModalSheet maxHeight="70%" onClose={onClose}>
        <View style={styles.periodSheet}>
          <Text accessibilityRole="header" style={styles.periodSheetTitle}>选择周期</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {periods.map((period, index) => {
              const selected = index === currentIndex;
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  key={period.weekOf}
                  onPress={() => onSelect(index)}
                  style={({ pressed }) => [styles.periodSheetRow, pressed && styles.rowPressed]}
                >
                  <View style={styles.periodSheetRowCopy}>
                    <Text style={[styles.periodSheetRowTitle, selected && styles.periodSheetRowTitleSelected]}>
                      {period.label}
                    </Text>
                  </View>
                  {selected ? (
                    <AppIcon color={colors.primaryStrong} name="checkmark" size={20} />
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </ModalSheet>
    </Modal>
  );
}

export function ReviewContent() {
  const periods = recentCompletedPeriods(8);
  const [periodIndex, setPeriodIndex] = useState(0);
  const [periodPickerVisible, setPeriodPickerVisible] = useState(false);
  const [expandedObservationId, setExpandedObservationId] = useState<string | null>(null);
  const [reflectionExpanded, setReflectionExpanded] = useState(false);
  const [reflection, setReflection] = useState('');

  const period = periods[periodIndex];
  const review = useWeeklyReview(period.weekOf);
  const metricGroups = groupReviewMetrics(review.metrics);

  const openPeriod = (nextIndex: number) => {
    setPeriodIndex(nextIndex);
    setExpandedObservationId(null);
    setReflectionExpanded(false);
    setPeriodPickerVisible(false);
  };

  const submitReflection = () => {
    const text = reflection.trim();
    if (!text) return;
    review.saveReflection(text);
    setReflectionExpanded(false);
  };

  const periodLabel = review.review
    ? `${review.review.period_start} 至 ${review.review.period_end}`
    : period.label;

  return (
    <>
      <Pressable
        accessibilityHint="打开历史周列表"
        accessibilityLabel={`选择复盘周期，当前为${periodLabel}`}
        accessibilityRole="button"
        onPress={() => setPeriodPickerVisible(true)}
        style={({ pressed }) => [styles.periodSelector, pressed && styles.pressed]}
      >
        <View style={styles.periodSelectorTitleRow}>
          <Text style={styles.periodText}>{periodLabel}</Text>
          <AppIcon color={colors.textSecondary} name="chevron-down" size={16} />
        </View>
        <Text style={styles.generatedAt}>
          {review.review?.generated_at
            ? `${formatRelativeTime(review.review.generated_at)}生成`
            : '指标实时计算'}
        </Text>
      </Pressable>

      {review.loading ? <ActivityIndicator color={colors.primary} style={styles.loading} /> : null}
      {review.failure ? <Text style={styles.failureText}>{review.failure}</Text> : null}

      {/*
        小结是可选增强：没有它时指标照样完整，因此这里给的是「生成」而不是
        一个空白区块，也不假装正在加载。
      */}
      <View style={styles.summarySection}>
        <View style={styles.summaryLabelRow}>
          <AiAssistantAvatar size={28} />
          <Text style={styles.summaryLabel}>AI 周总结</Text>
        </View>
        {review.loading || !review.review ? null : review.narrative ? (
          <>
            {review.headline ? (
              <Text accessibilityRole="header" style={styles.summaryHeadline}>
                {review.headline}
              </Text>
            ) : null}
            <Text style={styles.summaryText}>{review.narrative}</Text>
            {review.highlights.length > 0 ? (
              <View style={styles.highlightList}>
                {review.highlights.map((highlight) => {
                  const metric = review.metrics.find((item) => item.key === highlight.metric_key);
                  if (!metric) return null;
                  return (
                    <View key={highlight.metric_key} style={styles.highlightRow}>
                      <Text style={styles.highlightMetric}>
                        {metric.label} {formatMetric(metric)}
                      </Text>
                      <Text style={styles.highlightComment}>{highlight.comment}</Text>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </>
        ) : (
          <View style={styles.summaryEmptyRow}>
            <Text style={styles.summaryEmpty}>
              {review.hasReviewableData ? '本周暂无小结' : '本周暂无可复盘内容'}
            </Text>
            {review.hasReviewableData ? (
              <AppButton
                compact
                disabled={review.generating || review.loading}
                label={review.generating ? '正在生成…' : '生成小结'}
                onPress={review.generate}
                style={styles.generateButton}
                variant="secondary"
              />
            ) : null}
          </View>
        )}
      </View>

      {!review.loading && !review.narrative && review.hasReviewableData && review.metrics.length > 0 ? (
        <View accessibilityLabel="本周数据概览" style={styles.metricStrip}>
          {metricGroups.map((metrics) => (
            <View
              key={metrics.map((metric) => metric.key).join('-')}
              style={styles.metricRow}
            >
              {metrics.map((metric) => {
                const value = formatMetric(metric);
                const delta = formatDelta(metric);
                return (
                  <View
                    accessible
                    accessibilityLabel={`${metric.label}，${value}${delta ? `，${delta}` : ''}`}
                    key={metric.key}
                    style={styles.metricItem}
                  >
                    <Text style={styles.metricValue}>{value}</Text>
                    <Text style={styles.metricLabel}>{metric.label}</Text>
                    {delta ? <Text style={styles.metricDelta}>{delta}</Text> : null}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      ) : null}

      {/* 观察全部带来源：没有来源的结论在服务端就被丢掉了，不会到这里。 */}
      {review.observations.length > 0 ? (
        <>
          <ReviewSectionHeader title="本周观察" />
          <View style={styles.observationList}>
            {review.observations.map((observation) => {
              const expanded = expandedObservationId === observation.id;
              return (
                <View key={observation.id} style={styles.observation}>
                  <Text style={styles.observationBody}>{observation.text}</Text>
                  <Pressable
                    accessibilityLabel={`${expanded ? '收起' : '查看'}这条观察的依据`}
                    accessibilityRole="button"
                    onPress={() => setExpandedObservationId(expanded ? null : observation.id)}
                    style={({ pressed }) => [styles.sourceToggle, pressed && styles.pressed]}
                  >
                    <Text style={styles.sourceToggleText}>
                      {expanded ? '收起依据' : `查看依据（${observation.sources.length}）`}
                    </Text>
                    <AppIcon
                      color={colors.primaryStrong}
                      name={expanded ? 'chevron-up' : 'chevron-down'}
                      size={14}
                    />
                  </Pressable>
                  {expanded ? (
                    <View style={styles.sourceDetails}>
                      {observation.sources.map((source) => (
                        <SourceLink key={`${source.resourceType}-${source.resourceId}`} source={source} />
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </>
      ) : null}

      {/*
        下周建议就是待确认的 Action Proposal：它已经带了字段变化、来源与
        版本校验，确认后由服务端执行。没有待确认项时整块不显示，不摆空壳。
      */}
      {review.proposals.length > 0 ? (
        <>
          <ReviewSectionHeader title="下周建议" />
          <View style={styles.proposalList}>
            {review.proposals.map((proposal) => (
              <ProposalCard
                key={proposal.id}
                onResolved={review.refetch}
                proposal={proposal}
              />
            ))}
          </View>
        </>
      ) : null}

      <View style={styles.reflectionArea}>
        <Pressable
          accessibilityLabel={reflectionExpanded ? '收起个人补充' : '补充我的感受'}
          accessibilityRole="button"
          onPress={() => setReflectionExpanded((current) => !current)}
          style={({ pressed }) => [styles.reflectionTrigger, pressed && styles.pressed]}
        >
          <View style={styles.reflectionTriggerCopy}>
            <Text style={styles.reflectionTriggerTitle}>补充我的感受</Text>
            <Text numberOfLines={1} style={styles.reflectionTriggerMeta}>
              {review.reflectionSaved ? '已存成笔记' : '会存成一篇带「复盘」标签的笔记'}
            </Text>
          </View>
          <AppIcon
            color={colors.textSecondary}
            name={reflectionExpanded ? 'chevron-up' : 'chevron-down'}
            size={17}
          />
        </Pressable>

        {reflectionExpanded ? (
          <View style={styles.reflectionPanel}>
            <TextInput
              accessibilityLabel="补充本周感受"
              multiline
              onChangeText={setReflection}
              placeholder="写下一句真实感受"
              placeholderTextColor={colors.textSecondary}
              style={styles.reflectionInput}
              value={reflection}
            />
            <AppButton
              compact
              disabled={!reflection.trim() || review.savingReflection}
              label={review.savingReflection ? '正在保存…' : '存成笔记'}
              onPress={submitReflection}
            />
          </View>
        ) : null}
      </View>

      <ReviewPeriodPickerSheet
        currentIndex={periodIndex}
        onClose={() => setPeriodPickerVisible(false)}
        onSelect={openPeriod}
        periods={periods}
        visible={periodPickerVisible}
      />
    </>
  );
}

const styles = StyleSheet.create({
  loading: {
    marginTop: 20,
  },
  failureText: {
    marginTop: 12,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  summaryEmpty: {
    flexShrink: 1,
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
  },
  summaryEmptyRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  generateButton: {
    paddingHorizontal: 12,
    borderRadius: radius.pill,
  },
  metricDelta: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily,
    ...typography.caption,
  },
  proposalList: {
    gap: 12,
  },
  periodSelector: {
    minHeight: 62,
    alignItems: 'center',
    justifyContent: 'center',
  },
  periodSelectorTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  periodText: {
    color: colors.text,
    fontFamily,
    ...typography.bodyStrong,
    fontVariant: ['tabular-nums'],
  },
  generatedAt: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily,
    ...typography.caption,
  },
  summarySection: {
    paddingTop: 10,
    paddingBottom: 18,
  },
  summaryLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  summaryLabel: {
    color: colors.text,
    fontFamily,
    ...typography.section,
    fontWeight: '600',
  },
  summaryText: {
    marginTop: 6,
    maxWidth: 560,
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  summaryHeadline: {
    marginTop: 12,
    color: colors.text,
    fontFamily,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '600',
  },
  highlightList: {
    marginTop: 12,
    gap: 8,
  },
  highlightRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  highlightMetric: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  highlightComment: {
    minWidth: 0,
    flex: 1,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  metricStrip: {
    gap: 8,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  metricItem: {
    minWidth: 0,
    minHeight: 72,
    paddingHorizontal: 8,
    paddingVertical: 12,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  metricValue: {
    color: colors.text,
    fontFamily,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  metricLabel: {
    marginTop: 1,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  sectionHeader: {
    minHeight: 50,
    marginTop: 22,
    justifyContent: 'center',
  },
  sectionTitle: {
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  observationList: {
    gap: 20,
  },
  observation: {
    paddingHorizontal: 1,
  },
  observationTitle: {
    color: colors.text,
    fontFamily,
    ...typography.bodyStrong,
  },
  observationBody: {
    marginTop: 6,
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
  },
  sourceToggle: {
    minHeight: 40,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  sourceToggleText: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.meta,
    fontWeight: '500',
  },
  sourceDetails: {
    marginTop: 1,
    paddingHorizontal: 12,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  sourceLink: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sourceLinkText: {
    flex: 1,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    fontWeight: '500',
  },
  suggestionList: {
    overflow: 'hidden',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  suggestionRow: {
    minHeight: 84,
    paddingHorizontal: 14,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  suggestionRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  rowPressed: {
    backgroundColor: colors.surface,
  },
  suggestionCopy: {
    flex: 1,
    minWidth: 0,
  },
  suggestionTitle: {
    color: colors.text,
    fontFamily,
    ...typography.bodyStrong,
  },
  suggestionBody: {
    marginTop: 3,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  acceptedState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  acceptedStateText: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.caption,
  },
  reflectionArea: {
    marginTop: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  reflectionTrigger: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  reflectionTriggerCopy: {
    flex: 1,
    minWidth: 0,
  },
  reflectionTriggerTitle: {
    color: colors.text,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  reflectionTriggerMeta: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  reflectionPanel: {
    marginBottom: 10,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  reflectionInput: {
    minHeight: 72,
    maxHeight: 112,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: radius.sm,
    color: colors.text,
    backgroundColor: colors.background,
    fontFamily,
    ...typography.body,
    textAlignVertical: 'top',
  },
  confirmSheet: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 18,
  },
  confirmHeader: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  confirmHeaderCopy: {
    flex: 1,
  },
  confirmTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '600',
  },
  confirmSubtitle: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  closeButton: {
    width: 40,
    height: 40,
    marginLeft: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  periodSheet: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 18,
  },
  periodSheetHeader: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  periodSheetHeaderCopy: {
    flex: 1,
  },
  periodSheetTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '600',
  },
  periodSheetSubtitle: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  periodSheetList: {
    paddingTop: 8,
  },
  periodSheetRow: {
    minHeight: 68,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  periodSheetRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  periodSheetRowCopy: {
    flex: 1,
  },
  periodSheetRowTitle: {
    color: colors.text,
    fontFamily,
    ...typography.bodyStrong,
    fontVariant: ['tabular-nums'],
  },
  periodSheetRowTitleSelected: {
    color: colors.primaryStrong,
  },
  periodSheetRowMeta: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily,
    ...typography.caption,
  },
  confirmSuggestionTitle: {
    marginTop: 12,
    color: colors.text,
    fontFamily,
    ...typography.bodyStrong,
  },
  confirmReason: {
    marginTop: 4,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  changeSummary: {
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 3,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  changeRow: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  changeLabel: {
    width: 52,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  changeValue: {
    flex: 1,
    color: colors.text,
    fontFamily,
    ...typography.label,
  },
  confirmSource: {
    marginTop: 14,
  },
  confirmSourceLabel: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.caption,
  },
  confirmActions: {
    marginTop: 14,
  },
  pressed: {
    opacity: 0.58,
  },
});
