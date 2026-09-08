import type { ComponentProps } from 'react';
import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/icon';
import { ModalSheet } from '@/components/ui/modal-sheet';
import { AppSegmentedControl } from '@/components/ui/selection-controls';
import { StatePanel } from '@/components/ui/state-panel';
import { errorMessage, type Record as TrackerRecord } from '@steward/api-client';

import { buildMonthlyLedgerReport, ledgerDirection, type MonthlyLedgerReport } from './ledger-report';
import {
  numberOf,
  textOf,
  useBuiltinTracker,
} from '@/features/trackers/use-builtin-tracker';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';
import { formatRelativeTime } from '@/utils/format';

type LedgerEntryType = 'expense' | 'income';
type LedgerIconName = ComponentProps<typeof AppIcon>['name'];

type LedgerEntry = {
  id: string;
  title: string;
  category: string;
  amount: number;
  type: LedgerEntryType;
  time: string;
  timestamp: Date;
  account: string;
};

type CategoryOption = {
  label: string;
  icon: LedgerIconName;
};

const expenseCategories: CategoryOption[] = [
  { label: '餐饮', icon: 'restaurant-outline' },
  { label: '交通', icon: 'bus-outline' },
  { label: '购物', icon: 'bag-handle-outline' },
  { label: '居住', icon: 'home-outline' },
  { label: '其他', icon: 'ellipsis-horizontal' },
];

const incomeCategories: CategoryOption[] = [
  { label: '工资', icon: 'briefcase-outline' },
  { label: '奖金', icon: 'gift-outline' },
  { label: '退款', icon: 'return-down-back-outline' },
  { label: '其他', icon: 'ellipsis-horizontal' },
];


const categoryIconMap = new Map(
  [...expenseCategories, ...incomeCategories].map((category) => [category.label, category.icon]),
);

function formatAmount(value: number) {
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function ActionButton({
  icon,
  label,
  primary = false,
  onPress,
}: {
  icon: LedgerIconName;
  label: string;
  primary?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        primary ? styles.actionButtonPrimary : styles.actionButtonSecondary,
        pressed && styles.pressed,
      ]}
    >
      <AppIcon
        color={primary ? colors.background : colors.primaryStrong}
        name={icon}
        size={20}
      />
      <Text style={[styles.actionButtonText, primary && styles.actionButtonTextPrimary]}>
        {label}
      </Text>
    </Pressable>
  );
}

function CategoryPicker({
  options,
  selected,
  onSelect,
}: {
  options: CategoryOption[];
  selected: string;
  onSelect: (category: string) => void;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.categoryList}
      horizontal
      showsHorizontalScrollIndicator={false}
    >
      {options.map((option) => {
        const isSelected = option.label === selected;
        return (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: isSelected }}
            key={option.label}
            onPress={() => onSelect(option.label)}
            style={({ pressed }) => [
              styles.categoryOption,
              isSelected && styles.categoryOptionSelected,
              pressed && styles.pressed,
            ]}
          >
            <AppIcon
              color={isSelected ? colors.primaryStrong : colors.textSecondary}
              name={option.icon}
              size={18}
            />
            <Text
              style={[
                styles.categoryOptionText,
                isSelected && styles.categoryOptionTextSelected,
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function LedgerRow({ entry }: { entry: LedgerEntry }) {
  const isIncome = entry.type === 'income';
  const icon = categoryIconMap.get(entry.category) ?? 'receipt-outline';

  return (
    <View
      accessible
      accessibilityLabel={`${entry.title}，${entry.category}，${isIncome ? '收入' : '支出'}${formatAmount(entry.amount)}元`}
      style={styles.ledgerRow}
    >
      <View style={[styles.entryIcon, isIncome && styles.entryIconIncome]}>
        <AppIcon color={colors.primaryStrong} name={icon} size={19} />
      </View>
      <View style={styles.entryCopy}>
        <Text style={styles.entryTitle}>{entry.title}</Text>
        <Text style={styles.entryMeta}>
          {entry.category} · {entry.account} · {entry.time}
        </Text>
      </View>
      <Text style={[styles.entryAmount, isIncome && styles.entryAmountIncome]}>
        {isIncome ? '+' : '-'}¥{formatAmount(entry.amount)}
      </Text>
    </View>
  );
}

function MonthlyReport({
  report,
  onClose,
}: {
  report: MonthlyLedgerReport;
  onClose: () => void;
}) {
  const maxWeek = Math.max(0, ...report.weeklySpend);

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible>
      <ModalSheet maxHeight="94%" onClose={onClose}>
        <View style={styles.reportHeader}>
          <View>
            <Text accessibilityRole="header" style={styles.reportTitle}>{report.label}</Text>
            <Text style={styles.sheetSubtitle}>{report.period}</Text>
          </View>
          <Pressable
            accessibilityLabel="关闭月报"
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.closeButton, pressed && styles.rowPressed]}
          >
            <AppIcon name="close" size={22} />
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={styles.reportBody}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.reportPrimaryLabel}>本月支出</Text>
          <Text style={styles.reportPrimaryValue}>¥{formatAmount(report.expense)}</Text>
          <View style={styles.reportMetricRow}>
            <View style={styles.reportMetric}>
              <Text style={styles.reportMetricLabel}>本月收入</Text>
              <Text style={styles.reportMetricValue}>¥{formatAmount(report.income)}</Text>
            </View>
            <View style={styles.reportMetric}>
              <Text style={styles.reportMetricLabel}>本月结余</Text>
              <Text style={styles.reportMetricValue}>¥{formatAmount(report.balance)}</Text>
            </View>
          </View>

          <View style={styles.reportSection}>
            <View style={styles.reportSectionHeader}>
              <Text style={styles.reportSectionTitle}>每周支出</Text>
              <Text style={styles.reportSectionMeta}>{report.expenseCount} 笔真实记录</Text>
            </View>
            <View style={styles.weekChart}>
              {report.weeklySpend.map((value, index) => (
                <View key={`${value}-${index}`} style={styles.weekColumn}>
                  <View style={styles.weekBarTrack}>
                    <View
                      style={[
                        styles.weekBar,
                        { height: maxWeek > 0 ? Math.max(4, Math.round((value / maxWeek) * 84)) : 4 },
                      ]}
                    />
                  </View>
                  <Text style={styles.weekLabel}>第{index + 1}周</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.reportSection}>
            <Text style={styles.reportSectionTitle}>支出去向</Text>
            {report.categoryReport.length > 0 ? (
              <View style={styles.categoryReportList}>
                {report.categoryReport.map((item) => (
                <View key={item.label} style={styles.categoryReportRow}>
                  <View style={styles.categoryReportTopline}>
                    <View style={styles.categoryReportName}>
                      <AppIcon
                        color={colors.primaryStrong}
                        name={categoryIconMap.get(item.label) ?? 'receipt-outline'}
                        size={17}
                      />
                      <Text style={styles.categoryReportLabel}>{item.label}</Text>
                    </View>
                    <Text style={styles.categoryReportAmount}>¥{formatAmount(item.amount)}</Text>
                  </View>
                  <View style={styles.categoryReportTrack}>
                    <View
                      style={[
                        styles.categoryReportFill,
                        { width: `${Math.round(item.ratio * 100)}%` },
                      ]}
                    />
                  </View>
                </View>
                ))}
              </View>
            ) : (
              <Text style={styles.reportEmpty}>本月还没有支出记录。</Text>
            )}
          </View>

          <View style={styles.reportSection}>
            <Text style={styles.reportSectionTitle}>确定性摘要</Text>
            {report.categoryReport[0] ? (
              <View style={styles.insightList}>
                <View style={styles.insightRow}>
                  <View style={styles.insightIcon}>
                    <AppIcon
                      color={colors.primaryStrong}
                      name={categoryIconMap.get(report.categoryReport[0].label) ?? 'receipt-outline'}
                      size={18}
                    />
                  </View>
                  <Text style={styles.insightText}>
                    {report.categoryReport[0].label}是本月最大支出，占总支出的{' '}
                    {Math.round(report.categoryReport[0].ratio * 100)}%
                  </Text>
                </View>
              </View>
            ) : (
              <Text style={styles.reportEmpty}>有真实账单后，这里会按确定性规则生成摘要。</Text>
            )}
          </View>
        </ScrollView>
      </ModalSheet>
    </Modal>
  );
}

function LedgerSkeleton() {
  return (
    <View accessibilityLabel="正在加载账本" style={styles.ledgerSkeleton}>
      <View style={styles.skeletonOverview}>
        <View style={[styles.skeletonBlock, styles.skeletonHeading]} />
        <View style={[styles.skeletonBlock, styles.skeletonAmount]} />
        <View style={[styles.skeletonBlock, styles.skeletonMetric]} />
      </View>
      <View style={styles.skeletonActions}>
        <View style={[styles.skeletonBlock, styles.skeletonAction]} />
        <View style={[styles.skeletonBlock, styles.skeletonAction]} />
      </View>
      {[0, 1, 2].map((item) => (
        <View key={item} style={styles.skeletonRow}>
          <View style={[styles.skeletonBlock, styles.skeletonIcon]} />
          <View style={styles.skeletonRowCopy}>
            <View style={[styles.skeletonBlock, styles.skeletonRowTitle]} />
            <View style={[styles.skeletonBlock, styles.skeletonRowMeta]} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function LedgerContent() {
  const router = useRouter();
  const [reportNow] = useState(() => new Date());
  const reportRange = ledgerQueryRange(reportNow);
  const ledger = useBuiltinTracker('ledger', {
    from: reportRange.from,
    limit: 100,
    loadAll: true,
    to: reportRange.to,
  });
  const entries = useMemo<LedgerEntry[]>(
    () => ledger.records
      .map(toLedgerEntry)
      .filter((entry) => isCurrentMonthEntry(entry, reportNow)),
    [ledger.records, reportNow],
  );
  const [entryType, setEntryType] = useState<LedgerEntryType>('expense');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [category, setCategory] = useState('餐饮');
  const [manualOpen, setManualOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  const currentCategoryOptions = entryType === 'expense' ? expenseCategories : incomeCategories;
  const parsedAmount = Number(amount);
  const canSave = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const report = useMemo(
    () => buildMonthlyLedgerReport(entries, reportNow),
    [entries, reportNow],
  );

  const changeEntryType = (index: number) => {
    const nextType: LedgerEntryType = index === 0 ? 'expense' : 'income';
    setEntryType(nextType);
    setCategory(nextType === 'expense' ? expenseCategories[0].label : incomeCategories[0].label);
  };

  const saveManualEntry = async () => {
    if (!canSave || ledger.saving) return;
    setManualError(null);
    try {
      await ledger.saveAsync(
        {
          amount: parsedAmount,
          // 收支方向单独存，不用金额正负表达：负数在统计和展示里容易被读错。
          direction: entryType,
          category,
          merchant: note.trim() || undefined,
        },
        new Date(),
      );
      setAmount('');
      setNote('');
      setManualOpen(false);
    } catch (error) {
      setManualError(errorMessage(error, '保存失败，输入内容已保留，请重试。'));
    }
  };

  if (ledger.loading) return <LedgerSkeleton />;

  if (ledger.failed) {
    return (
      <StatePanel
        actionLabel="重试"
        icon="cloud-offline-outline"
        message={errorMessage(ledger.queryError, '暂时无法加载账本。')}
        onAction={() => void ledger.refetch()}
        title="账本加载失败"
      />
    );
  }

  return (
    <>
      <View style={styles.overview}>
        <View style={styles.overviewHeader}>
          <View>
            <Text style={styles.overviewPeriod}>{report.label.replace('月报', '账本')}</Text>
            <Text style={styles.overviewDate}>截至今天</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => setReportOpen(true)}
            style={({ pressed }) => [styles.reportLink, pressed && styles.rowPressed]}
          >
            <Text style={styles.reportLinkText}>查看月报</Text>
            <AppIcon color={colors.primaryStrong} name="chevron-forward" size={16} />
          </Pressable>
        </View>

        <Text style={styles.overviewPrimaryLabel}>本月支出</Text>
        <Text style={styles.overviewPrimaryValue}>¥{formatAmount(report.expense)}</Text>
        <View style={styles.overviewMetrics}>
          <View style={styles.overviewMetric}>
            <Text style={styles.overviewMetricLabel}>本月收入</Text>
            <Text style={styles.overviewMetricValue}>¥{formatAmount(report.income)}</Text>
          </View>
          <View style={styles.overviewMetric}>
            <Text style={styles.overviewMetricLabel}>本月结余</Text>
            <Text style={styles.overviewMetricValue}>¥{formatAmount(report.balance)}</Text>
          </View>
        </View>
        <Text style={styles.overviewFootnote}>仅汇总当前月已保存的真实账单</Text>
      </View>

      <View style={styles.actionRow}>
        <ActionButton
          icon="camera-outline"
          label="拍照记账"
          onPress={() => router.push({ pathname: '/capture/new', params: { intent: 'ledger' } })}
          primary
        />
        <ActionButton
          icon={manualOpen ? 'close' : 'add'}
          label={manualOpen ? '收起' : '手动记账'}
          onPress={() => {
            setManualError(null);
            setManualOpen((current) => !current);
          }}
        />
      </View>

      {manualOpen ? (
        <View style={styles.manualPanel}>
          <AppSegmentedControl
            onChange={(event) => changeEntryType(event.nativeEvent.selectedSegmentIndex)}
            selectedIndex={entryType === 'expense' ? 0 : 1}
            style={styles.segmentedControl}
            values={['支出', '收入']}
          />
          <View style={styles.amountField}>
            <Text style={styles.currency}>¥</Text>
            <TextInput
              accessibilityLabel="金额"
              keyboardType="decimal-pad"
              onChangeText={setAmount}
              placeholder="0.00"
              placeholderTextColor={colors.textSecondary}
              style={styles.amountInput}
              value={amount}
            />
          </View>
          <Text style={styles.fieldLabel}>分类</Text>
          <CategoryPicker
            onSelect={setCategory}
            options={currentCategoryOptions}
            selected={category}
          />
          <TextInput
            accessibilityLabel="备注"
            onChangeText={setNote}
            placeholder="添加商家或备注（选填）"
            placeholderTextColor={colors.textSecondary}
            style={styles.noteInput}
            value={note}
          />
          {manualError ? (
            <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.manualError}>
              {manualError}
            </Text>
          ) : null}
          <AppButton
            disabled={!canSave || ledger.saving}
            label={ledger.saving ? '正在保存…' : '保存这笔记录'}
            onPress={() => void saveManualEntry()}
          />
        </View>
      ) : null}

      <View style={styles.listHeader}>
        <Text accessibilityRole="header" style={styles.listTitle}>本月账单</Text>
        {entries.length > 5 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowAll((current) => !current)}
            style={({ pressed }) => [styles.allBillsLink, pressed && styles.rowPressed]}
          >
            <Text style={styles.allBillsText}>{showAll ? '收起' : '展开全部'}</Text>
            <AppIcon
              color={colors.textSecondary}
              name={showAll ? 'chevron-up' : 'chevron-down'}
              size={15}
            />
          </Pressable>
        ) : null}
      </View>
      {entries.length > 0 ? (
        <View style={styles.entryList}>
          {(showAll ? entries : entries.slice(0, 5)).map((entry) => (
            <LedgerRow entry={entry} key={entry.id} />
          ))}
        </View>
      ) : (
        <View style={styles.emptyLedger}>
          <AppIcon color={colors.textTertiary} name="receipt-outline" size={28} />
          <Text style={styles.emptyLedgerTitle}>还没有账单</Text>
          <Text style={styles.emptyLedgerCopy}>手动记一笔，或上传票据进入统一 AI 确认流程。</Text>
        </View>
      )}

      {reportOpen ? (
        <MonthlyReport
          report={report}
          onClose={() => setReportOpen(false)}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  overview: {
    marginTop: 8,
    padding: 18,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  overviewHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  overviewPeriod: {
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  overviewDate: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  reportLink: {
    minHeight: 44,
    marginTop: -8,
    marginRight: -8,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  reportLinkText: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  overviewPrimaryLabel: {
    marginTop: 21,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  overviewPrimaryValue: {
    marginTop: 3,
    color: colors.text,
    fontFamily,
    fontSize: 30,
    lineHeight: 38,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.4,
  },
  overviewMetrics: {
    marginTop: 20,
    flexDirection: 'row',
    gap: 28,
  },
  overviewMetric: {
    flex: 1,
  },
  overviewMetricLabel: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  overviewMetricValue: {
    marginTop: 4,
    color: colors.text,
    fontFamily,
    ...typography.bodyStrong,
    fontVariant: ['tabular-nums'],
  },
  overviewFootnote: {
    marginTop: 20,
    color: colors.textTertiary,
    fontFamily,
    ...typography.caption,
  },
  actionRow: {
    marginTop: 16,
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    minHeight: 52,
    flex: 1,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  actionButtonPrimary: {
    backgroundColor: colors.primary,
  },
  actionButtonSecondary: {
    backgroundColor: colors.primarySoft,
  },
  actionButtonText: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  actionButtonTextPrimary: {
    color: colors.background,
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.985 }],
  },
  manualPanel: {
    marginTop: 12,
    padding: 16,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  segmentedControl: {
    height: 38,
  },
  amountField: {
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
  },
  currency: {
    color: colors.text,
    fontFamily,
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '600',
  },
  amountInput: {
    flex: 1,
    height: 72,
    paddingHorizontal: 10,
    color: colors.text,
    fontFamily,
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  fieldLabel: {
    marginTop: 10,
    marginBottom: 8,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    fontWeight: '500',
  },
  categoryList: {
    gap: 8,
    paddingRight: 4,
  },
  categoryOption: {
    minHeight: 42,
    paddingHorizontal: 13,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
  },
  categoryOptionSelected: {
    backgroundColor: colors.primarySoft,
  },
  categoryOptionText: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    fontWeight: '500',
  },
  categoryOptionTextSelected: {
    color: colors.primaryStrong,
    fontWeight: '600',
  },
  noteInput: {
    minHeight: 48,
    marginTop: 14,
    marginBottom: 14,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    color: colors.text,
    fontFamily,
    ...typography.body,
    backgroundColor: colors.background,
  },
  manualError: {
    marginBottom: 12,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  listHeader: {
    minHeight: 58,
    marginTop: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  listTitle: {
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  allBillsLink: {
    minHeight: 44,
    marginRight: -6,
    paddingHorizontal: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  allBillsText: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  entryList: {
    gap: 3,
  },
  emptyLedger: {
    minHeight: 180,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyLedgerTitle: {
    marginTop: 10,
    color: colors.text,
    fontFamily,
    ...typography.bodyStrong,
  },
  emptyLedgerCopy: {
    maxWidth: 300,
    marginTop: 5,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    textAlign: 'center',
  },
  ledgerRow: {
    minHeight: 67,
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowPressed: {
    opacity: 0.58,
  },
  entryIcon: {
    width: 40,
    height: 40,
    marginRight: 12,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  entryIconIncome: {
    backgroundColor: colors.primarySoft,
  },
  entryCopy: {
    flex: 1,
    minWidth: 0,
  },
  entryTitle: {
    color: colors.text,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  entryMeta: {
    marginTop: 3,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
  },
  entryAmount: {
    marginLeft: 12,
    color: colors.text,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  entryAmountIncome: {
    color: colors.primaryStrong,
  },
  sheetSubtitle: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  reportHeader: {
    minHeight: 76,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reportTitle: {
    color: colors.text,
    fontFamily,
    ...typography.detail,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportBody: {
    paddingHorizontal: 20,
    paddingBottom: 34,
  },
  reportPrimaryLabel: {
    marginTop: 12,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  reportPrimaryValue: {
    marginTop: 4,
    color: colors.text,
    fontFamily,
    fontSize: 34,
    lineHeight: 42,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.5,
  },
  reportMetricRow: {
    marginTop: 22,
    flexDirection: 'row',
    gap: 32,
  },
  reportMetric: {
    flex: 1,
  },
  reportMetricLabel: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  reportMetricValue: {
    marginTop: 5,
    color: colors.text,
    fontFamily,
    ...typography.bodyStrong,
    fontVariant: ['tabular-nums'],
  },
  reportSection: {
    marginTop: 34,
  },
  reportSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  reportSectionTitle: {
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  reportSectionMeta: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.meta,
    fontWeight: '500',
  },
  weekChart: {
    height: 126,
    marginTop: 18,
    paddingHorizontal: 5,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  weekColumn: {
    flex: 1,
    alignItems: 'center',
  },
  weekBarTrack: {
    height: 88,
    justifyContent: 'flex-end',
  },
  weekBar: {
    width: 24,
    borderRadius: radius.sm,
    backgroundColor: colors.primaryTrack,
  },
  weekLabel: {
    marginTop: 8,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
  },
  categoryReportList: {
    marginTop: 18,
    gap: 18,
  },
  categoryReportRow: {
    gap: 8,
  },
  categoryReportTopline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  categoryReportName: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryReportLabel: {
    color: colors.text,
    fontFamily,
    ...typography.label,
  },
  categoryReportAmount: {
    color: colors.text,
    fontFamily,
    ...typography.label,
    fontVariant: ['tabular-nums'],
  },
  categoryReportTrack: {
    height: 6,
    overflow: 'hidden',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  categoryReportFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  insightList: {
    marginTop: 14,
    gap: 10,
  },
  insightRow: {
    minHeight: 54,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSubtle,
  },
  insightIcon: {
    width: 34,
    height: 34,
    marginRight: 10,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  insightText: {
    flex: 1,
    color: colors.text,
    fontFamily,
    ...typography.meta,
  },
  reportEmpty: {
    marginTop: 12,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  ledgerSkeleton: {
    paddingTop: 8,
  },
  skeletonOverview: {
    minHeight: 196,
    padding: 18,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  skeletonBlock: {
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  skeletonHeading: {
    width: 92,
    height: 18,
  },
  skeletonAmount: {
    width: 156,
    height: 36,
    marginTop: 36,
  },
  skeletonMetric: {
    width: '72%',
    height: 17,
    marginTop: 28,
  },
  skeletonActions: {
    marginTop: 16,
    flexDirection: 'row',
    gap: 10,
  },
  skeletonAction: {
    height: 52,
    flex: 1,
    borderRadius: radius.md,
  },
  skeletonRow: {
    minHeight: 67,
    flexDirection: 'row',
    alignItems: 'center',
  },
  skeletonIcon: {
    width: 40,
    height: 40,
    marginRight: 12,
    borderRadius: radius.md,
  },
  skeletonRowCopy: {
    flex: 1,
    gap: 7,
  },
  skeletonRowTitle: {
    width: '44%',
    height: 14,
  },
  skeletonRowMeta: {
    width: '68%',
    height: 11,
  },
});

/** 把一条记录映射成展示模型。 */
function toLedgerEntry(row: TrackerRecord): LedgerEntry {
  const category = textOf(row, 'category') ?? '其他';
  return {
    id: row.id,
    title: textOf(row, 'merchant') ?? category,
    category,
    amount: numberOf(row, 'amount') ?? 0,
    type: ledgerDirection(textOf(row, 'direction')),
    time: formatRelativeTime(row.timestamp),
    timestamp: new Date(row.timestamp),
    account: textOf(row, 'payment_method') ?? '默认账户',
  };
}

/**
 * Record 接口的日期筛选按 UTC 日期解释；查询边界各放宽一天后再按设备当地月份过滤，
 * 避免 UTC 偏移让月初、月末账单漏出统计。
 */
function ledgerQueryRange(now: Date) {
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 0);
  const dayAfterToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return {
    from: formatLocalDate(firstDay),
    to: formatLocalDate(dayAfterToday),
  };
}

function isCurrentMonthEntry(entry: LedgerEntry, now: Date) {
  return entry.timestamp <= now
    && entry.timestamp.getFullYear() === now.getFullYear()
    && entry.timestamp.getMonth() === now.getMonth();
}

function formatLocalDate(value: Date) {
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}
