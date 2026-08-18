import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { AiAssistantAvatar } from '@/components/ui/ai-assistant-avatar';
import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/icon';
import { ModalSheet } from '@/components/ui/modal-sheet';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

type ReviewHref = '/lists' | '/focus' | '/data';

type ReviewSource = {
  label: string;
  href: ReviewHref;
};

type ReviewObservation = {
  id: string;
  title: string;
  body: string;
  sources: ReviewSource[];
};

type ReviewSuggestion = {
  id: string;
  title: string;
  body: string;
  target: string;
  change: string;
  source: ReviewSource;
};

type ReviewSnapshot = {
  id: string;
  period: string;
  generatedAt: string;
  summary: string;
  metrics: { label: string; value: string }[];
  observations: ReviewObservation[];
  suggestions: ReviewSuggestion[];
  reflectionPrompt: string;
};

const reviewSnapshots: ReviewSnapshot[] = [
  {
    id: '2026-08-10',
    period: '8月10日—8月16日',
    generatedAt: '8月17日 08:30 生成',
    summary:
      '这一周，你把主要精力放在产品评审上，整体完成比较稳定。不过两项重要任务都集中到了周五，后半周的安排明显更紧张。',
    metrics: [
      { label: '完成', value: '12 项' },
      { label: '延期', value: '3 项' },
      { label: '专注', value: '6 次' },
      { label: '打卡', value: '5/7 天' },
    ],
    observations: [
      {
        id: 'late-week-load',
        title: '重要任务集中在后半周',
        body: '周一到周三推进更稳定，临时任务主要出现在周四和周五，挤压了原本留给产品评审的时间。',
        sources: [
          { label: '4 项相关任务', href: '/lists' },
          { label: '本周计划', href: '/lists' },
        ],
      },
      {
        id: 'focus-rhythm',
        title: '上午的专注更容易形成连续完成',
        body: '本周 6 次专注里有 4 次发生在上午，其中 3 次之后都连续完成了两项以上任务。',
        sources: [
          { label: '6 次专注记录', href: '/focus' },
          { label: '5 项完成任务', href: '/lists' },
        ],
      },
    ],
    suggestions: [
      {
        id: 'schedule-client-email',
        title: '把“回复客户邮件”安排到周三上午',
        body: '给它一个明确时间，避免再次被临时事务顺延。',
        target: '回复客户邮件',
        change: '未安排 → 8月19日 周三 10:00',
        source: { label: '查看顺延记录', href: '/lists' },
      },
      {
        id: 'reserve-review-time',
        title: '周四预留 30 分钟整理评审结论',
        body: '把评审后的整理单独留出时间，减少周五集中收尾。',
        target: '整理产品评审结论',
        change: '未创建 → 8月20日 周四 16:00',
        source: { label: '查看评审相关任务', href: '/lists' },
      },
    ],
    reflectionPrompt: '这周最值得记住的一件事是什么？',
  },
  {
    id: '2026-08-03',
    period: '8月3日—8月9日',
    generatedAt: '8月10日 08:42 生成',
    summary:
      '上一周的任务量不高，但执行节奏更均匀。你连续完成了三次运动记录，也把两个长期搁置的小任务处理掉了。',
    metrics: [
      { label: '完成', value: '9 项' },
      { label: '延期', value: '1 项' },
      { label: '专注', value: '4 次' },
      { label: '打卡', value: '6/7 天' },
    ],
    observations: [
      {
        id: 'steady-pace',
        title: '任务分布比前一周更均匀',
        body: '每天都有明确的收尾动作，没有出现任务集中到周末处理的情况。',
        sources: [{ label: '9 项完成任务', href: '/lists' }],
      },
      {
        id: 'exercise-streak',
        title: '运动记录形成了连续性',
        body: '周二、周四和周六都留下了运动记录，间隔相对稳定。',
        sources: [{ label: '3 条运动记录', href: '/data' }],
      },
    ],
    suggestions: [
      {
        id: 'keep-exercise-slot',
        title: '保留周二、周四的运动时段',
        body: '延续已经形成的节奏，比重新安排更容易坚持。',
        target: '本周运动安排',
        change: '未安排 → 周二、周四 19:00',
        source: { label: '查看运动记录', href: '/data' },
      },
    ],
    reflectionPrompt: '上一周有什么做法值得继续保留？',
  },
];

function ReviewSectionHeader({ title }: { title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
    </View>
  );
}

function SourceLink({ source }: { source: ReviewSource }) {
  const router = useRouter();

  return (
    <Pressable
      accessibilityLabel={`${source.label}，查看来源`}
      accessibilityRole="link"
      onPress={() => router.push(source.href)}
      style={({ pressed }) => [styles.sourceLink, pressed && styles.pressed]}
    >
      <AppIcon color={colors.textSecondary} name="document-text-outline" size={16} />
      <Text style={styles.sourceLinkText}>{source.label}</Text>
      <AppIcon color={colors.borderStrong} name="chevron-forward" size={15} />
    </Pressable>
  );
}

function SuggestionConfirmSheet({
  suggestion,
  accepted,
  onClose,
  onConfirm,
}: {
  suggestion: ReviewSuggestion | null;
  accepted: boolean;
  onClose: () => void;
  onConfirm: (suggestion: ReviewSuggestion) => void;
}) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={Boolean(suggestion)}
    >
      <ModalSheet maxHeight="68%" onClose={onClose}>
        {suggestion ? (
          <View style={styles.confirmSheet}>
            <View style={styles.confirmHeader}>
              <View style={styles.confirmHeaderCopy}>
                <Text accessibilityRole="header" style={styles.confirmTitle}>
                  建议详情
                </Text>
                <Text style={styles.confirmSubtitle}>确认后才会修改计划</Text>
              </View>
              <Pressable
                accessibilityLabel="关闭建议详情"
                accessibilityRole="button"
                onPress={onClose}
                style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
              >
                <AppIcon color={colors.text} name="close" size={22} />
              </Pressable>
            </View>

            <Text style={styles.confirmSuggestionTitle}>{suggestion.title}</Text>
            <Text style={styles.confirmReason}>{suggestion.body}</Text>

            <View style={styles.changeSummary}>
              <View style={styles.changeRow}>
                <Text style={styles.changeLabel}>任务</Text>
                <Text style={styles.changeValue}>{suggestion.target}</Text>
              </View>
              <View style={styles.changeRow}>
                <Text style={styles.changeLabel}>安排</Text>
                <Text style={styles.changeValue}>{suggestion.change}</Text>
              </View>
            </View>

            <View style={styles.confirmSource}>
              <Text style={styles.confirmSourceLabel}>建议依据</Text>
              <SourceLink source={suggestion.source} />
            </View>

            <View style={styles.confirmActions}>
              {accepted ? (
                <AppButton disabled icon="checkmark" label="已加入计划" variant="secondary" />
              ) : (
                <AppButton
                  icon="checkmark"
                  label="确认加入计划"
                  onPress={() => onConfirm(suggestion)}
                />
              )}
              <AppButton label="关闭" onPress={onClose} variant="text" />
            </View>
          </View>
        ) : null}
      </ModalSheet>
    </Modal>
  );
}

function ReviewPeriodPickerSheet({
  currentIndex,
  onClose,
  onSelect,
  visible,
}: {
  currentIndex: number;
  onClose: () => void;
  onSelect: (index: number) => void;
  visible: boolean;
}) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <ModalSheet maxHeight="62%" onClose={onClose}>
        <View style={styles.periodSheet}>
          <View style={styles.periodSheetHeader}>
            <View style={styles.periodSheetHeaderCopy}>
              <Text accessibilityRole="header" style={styles.periodSheetTitle}>
                选择复盘周期
              </Text>
              <Text style={styles.periodSheetSubtitle}>查看已生成的周复盘</Text>
            </View>
            <Pressable
              accessibilityLabel="关闭周期选择"
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
            >
              <AppIcon color={colors.text} name="close" size={22} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.periodSheetList}
            showsVerticalScrollIndicator={false}
          >
            {reviewSnapshots.map((snapshot, index) => {
              const selected = index === currentIndex;

              return (
                <Pressable
                  accessibilityLabel={`选择复盘周期：${snapshot.period}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={snapshot.id}
                  onPress={() => onSelect(index)}
                  style={({ pressed }) => [
                    styles.periodSheetRow,
                    index > 0 && styles.periodSheetRowDivider,
                    pressed && styles.rowPressed,
                  ]}
                >
                  <View style={styles.periodSheetRowCopy}>
                    <Text
                      style={[
                        styles.periodSheetRowTitle,
                        selected && styles.periodSheetRowTitleSelected,
                      ]}
                    >
                      {snapshot.period}
                    </Text>
                    <Text style={styles.periodSheetRowMeta}>{snapshot.generatedAt}</Text>
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
  const [periodIndex, setPeriodIndex] = useState(0);
  const [periodPickerVisible, setPeriodPickerVisible] = useState(false);
  const [expandedObservationId, setExpandedObservationId] = useState<string | null>(null);
  const [reflectionExpanded, setReflectionExpanded] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState<ReviewSuggestion | null>(null);
  const [acceptedSuggestionIds, setAcceptedSuggestionIds] = useState<Record<string, boolean>>({});
  const [reflectionNotes, setReflectionNotes] = useState<Record<string, string>>({});
  const [savedReflectionIds, setSavedReflectionIds] = useState<Record<string, boolean>>({});
  const review = reviewSnapshots[periodIndex];
  const reflection = reflectionNotes[review.id] ?? '';
  const reflectionSaved = Boolean(savedReflectionIds[review.id]);
  const selectedSuggestionAccepted = selectedSuggestion
    ? Boolean(acceptedSuggestionIds[selectedSuggestion.id])
    : false;

  const openPeriod = (nextIndex: number) => {
    setPeriodIndex(nextIndex);
    setExpandedObservationId(null);
    setReflectionExpanded(false);
    setPeriodPickerVisible(false);
  };

  const updateReflection = (value: string) => {
    setReflectionNotes((current) => ({ ...current, [review.id]: value }));
    setSavedReflectionIds((current) => ({ ...current, [review.id]: false }));
  };

  const saveReflection = () => {
    setSavedReflectionIds((current) => ({ ...current, [review.id]: true }));
    setReflectionExpanded(false);
  };

  const acceptSuggestion = (suggestion: ReviewSuggestion) => {
    setAcceptedSuggestionIds((current) => ({ ...current, [suggestion.id]: true }));
    setSelectedSuggestion(null);
  };

  return (
    <>
      <Pressable
        accessibilityHint="打开历史周列表"
        accessibilityLabel={`选择复盘周期，当前为${review.period}`}
        accessibilityRole="button"
        onPress={() => setPeriodPickerVisible(true)}
        style={({ pressed }) => [styles.periodSelector, pressed && styles.pressed]}
      >
        <View style={styles.periodSelectorTitleRow}>
          <Text style={styles.periodText}>{review.period}</Text>
          <AppIcon color={colors.textSecondary} name="chevron-down" size={16} />
        </View>
        <Text style={styles.generatedAt}>{review.generatedAt}</Text>
      </Pressable>

      <View style={styles.summarySection}>
        <View style={styles.summaryLabelRow}>
          <AiAssistantAvatar size={28} />
          <Text style={styles.summaryLabel}>AI 周总结</Text>
        </View>
        <Text style={styles.summaryText}>{review.summary}</Text>
      </View>

      <View accessibilityLabel="本周数据概览" style={styles.metricStrip}>
        {review.metrics.map((metric) => (
          <View key={metric.label} style={styles.metricItem}>
            <Text style={styles.metricValue}>{metric.value}</Text>
            <Text style={styles.metricLabel}>{metric.label}</Text>
          </View>
        ))}
      </View>

      <ReviewSectionHeader title="本周观察" />
      <View style={styles.observationList}>
        {review.observations.map((observation) => {
          const expanded = expandedObservationId === observation.id;

          return (
            <View key={observation.id} style={styles.observation}>
              <Text style={styles.observationTitle}>{observation.title}</Text>
              <Text style={styles.observationBody}>{observation.body}</Text>
              <Pressable
                accessibilityLabel={`${expanded ? '收起' : '查看'}${observation.title}的依据`}
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
                    <SourceLink key={source.label} source={source} />
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>

      <ReviewSectionHeader title="下周建议" />
      <View style={styles.suggestionList}>
        {review.suggestions.map((suggestion, index) => {
          const accepted = Boolean(acceptedSuggestionIds[suggestion.id]);

          return (
            <Pressable
              accessibilityLabel={`${suggestion.title}，${accepted ? '已加入计划' : '查看建议'}`}
              accessibilityRole="button"
              key={suggestion.id}
              onPress={() => setSelectedSuggestion(suggestion)}
              style={({ pressed }) => [
                styles.suggestionRow,
                index > 0 && styles.suggestionRowDivider,
                pressed && styles.rowPressed,
              ]}
            >
              <View style={styles.suggestionCopy}>
                <Text style={styles.suggestionTitle}>{suggestion.title}</Text>
                <Text style={styles.suggestionBody}>{suggestion.body}</Text>
              </View>
              {accepted ? (
                <View style={styles.acceptedState}>
                  <AppIcon color={colors.primaryStrong} name="checkmark-circle" size={17} />
                  <Text style={styles.acceptedStateText}>已采用</Text>
                </View>
              ) : (
                <AppIcon color={colors.borderStrong} name="chevron-forward" size={18} />
              )}
            </Pressable>
          );
        })}
      </View>

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
              {reflectionSaved && reflection.trim()
                ? `已补充：${reflection.trim()}`
                : review.reflectionPrompt}
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
              onChangeText={updateReflection}
              placeholder="写下一句真实感受"
              placeholderTextColor={colors.textSecondary}
              style={styles.reflectionInput}
              value={reflection}
            />
            <AppButton
              compact
              disabled={!reflection.trim()}
              label={reflectionSaved ? '已保存' : '加入本次复盘'}
              onPress={saveReflection}
            />
          </View>
        ) : null}
      </View>

      <SuggestionConfirmSheet
        accepted={selectedSuggestionAccepted}
        onClose={() => setSelectedSuggestion(null)}
        onConfirm={acceptSuggestion}
        suggestion={selectedSuggestion}
      />
      <ReviewPeriodPickerSheet
        currentIndex={periodIndex}
        onClose={() => setPeriodPickerVisible(false)}
        onSelect={openPeriod}
        visible={periodPickerVisible}
      />
    </>
  );
}

const styles = StyleSheet.create({
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
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    fontWeight: '600',
  },
  summaryText: {
    marginTop: 12,
    maxWidth: 560,
    color: colors.text,
    fontFamily,
    fontSize: 18,
    lineHeight: 28,
    fontWeight: '600',
    letterSpacing: -0.15,
  },
  metricStrip: {
    minHeight: 50,
    paddingHorizontal: 2,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  metricItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  metricValue: {
    color: colors.text,
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  metricLabel: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
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
