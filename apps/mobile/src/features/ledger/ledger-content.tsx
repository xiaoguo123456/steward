import type { ComponentProps } from 'react';
import { useEffect, useMemo, useState } from 'react';
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
import type { Record as TrackerRecord } from '@steward/api-client';

import {
  numberOf,
  textOf,
  useBuiltinTracker,
} from '@/features/trackers/use-builtin-tracker';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';
import { formatRelativeTime } from '@/utils/format';

type LedgerEntryType = 'expense' | 'income';
type ScanStep = 'source' | 'processing' | 'review';
type LedgerIconName = ComponentProps<typeof AppIcon>['name'];

type LedgerEntry = {
  id: string;
  title: string;
  category: string;
  amount: number;
  type: LedgerEntryType;
  time: string;
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

const categoryReport = [
  { label: '餐饮', amount: 1146, ratio: 0.35, icon: 'restaurant-outline' as const },
  { label: '居住', amount: 920, ratio: 0.28, icon: 'home-outline' as const },
  { label: '购物', amount: 624, ratio: 0.19, icon: 'bag-handle-outline' as const },
];

const weeklySpend = [620, 1030, 890, 746];

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
    <Pressable
      accessibilityLabel={`${entry.title}，${entry.category}，${isIncome ? '收入' : '支出'}${formatAmount(entry.amount)}元`}
      accessibilityRole="button"
      style={({ pressed }) => [styles.ledgerRow, pressed && styles.rowPressed]}
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
    </Pressable>
  );
}

function ScanSource({ onSelect }: { onSelect: () => void }) {
  return (
    <>
      <View style={styles.sheetHeader}>
        <View>
          <Text accessibilityRole="header" style={styles.sheetTitle}>拍照记账</Text>
          <Text style={styles.sheetSubtitle}>识别后先确认，再写入账本</Text>
        </View>
      </View>
      <View style={styles.sourceActions}>
        <Pressable
          accessibilityRole="button"
          onPress={onSelect}
          style={({ pressed }) => [styles.sourceRow, pressed && styles.rowPressed]}
        >
          <View style={styles.sourceIcon}>
            <AppIcon color={colors.primaryStrong} name="camera-outline" size={22} />
          </View>
          <View style={styles.sourceCopy}>
            <Text style={styles.sourceTitle}>拍摄小票</Text>
            <Text style={styles.sourceMeta}>适合纸质小票、发票和收据</Text>
          </View>
          <AppIcon color={colors.borderStrong} name="chevron-forward" size={18} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onSelect}
          style={({ pressed }) => [styles.sourceRow, pressed && styles.rowPressed]}
        >
          <View style={styles.sourceIcon}>
            <AppIcon color={colors.primaryStrong} name="images-outline" size={22} />
          </View>
          <View style={styles.sourceCopy}>
            <Text style={styles.sourceTitle}>选择账单截图</Text>
            <Text style={styles.sourceMeta}>支持支付账单和电子小票截图</Text>
          </View>
          <AppIcon color={colors.borderStrong} name="chevron-forward" size={18} />
        </Pressable>
      </View>
    </>
  );
}

function ScanProcessing() {
  return (
    <View accessibilityLiveRegion="polite" style={styles.processingBody}>
      <View style={styles.receiptPreview}>
        <View style={styles.receiptIcon}>
          <AppIcon color={colors.primaryStrong} name="receipt-outline" size={25} />
        </View>
        <View style={[styles.skeletonLine, styles.skeletonLineWide]} />
        <View style={[styles.skeletonLine, styles.skeletonLineMedium]} />
        <View style={[styles.skeletonLine, styles.skeletonLineShort]} />
      </View>
      <Text style={styles.processingTitle}>正在读取账单</Text>
      <Text style={styles.processingCopy}>识别商家、金额、时间和支付方式…</Text>
    </View>
  );
}

function ScanReview({
  amount,
  merchant,
  category,
  onAmountChange,
  onMerchantChange,
  onCategoryChange,
  onConfirm,
  onRetry,
}: {
  amount: string;
  merchant: string;
  category: string;
  onAmountChange: (value: string) => void;
  onMerchantChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onConfirm: () => void;
  onRetry: () => void;
}) {
  const parsedAmount = Number(amount);
  const canConfirm = merchant.trim().length > 0 && Number.isFinite(parsedAmount) && parsedAmount > 0;

  return (
    <>
      <View style={styles.sheetHeader}>
        <View>
          <Text accessibilityRole="header" style={styles.sheetTitle}>确认识别结果</Text>
          <Text style={styles.sheetSubtitle}>有误的内容可以直接修改</Text>
        </View>
        <View style={styles.recognizedBadge}>
          <AppIcon color={colors.primaryStrong} name="checkmark-circle" size={17} />
          <Text style={styles.recognizedBadgeText}>已识别</Text>
        </View>
      </View>
      <ScrollView
        contentContainerStyle={styles.reviewBody}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.recognizedSource}>
          <View style={styles.recognizedSourceIcon}>
            <AppIcon color={colors.primaryStrong} name="receipt-outline" size={22} />
          </View>
          <View style={styles.sourceCopy}>
            <Text style={styles.sourceTitle}>购物小票</Text>
            <Text style={styles.sourceMeta}>今天 14:32 · 微信支付</Text>
          </View>
        </View>

        <Text style={styles.fieldLabel}>金额</Text>
        <View style={styles.reviewAmountField}>
          <Text style={styles.reviewCurrency}>¥</Text>
          <TextInput
            accessibilityLabel="识别金额"
            keyboardType="decimal-pad"
            onChangeText={onAmountChange}
            style={styles.reviewAmountInput}
            value={amount}
          />
        </View>

        <Text style={styles.fieldLabel}>商家或备注</Text>
        <TextInput
          accessibilityLabel="识别商家或备注"
          onChangeText={onMerchantChange}
          style={styles.reviewTextInput}
          value={merchant}
        />

        <Text style={styles.fieldLabel}>分类</Text>
        <CategoryPicker
          onSelect={onCategoryChange}
          options={expenseCategories}
          selected={category}
        />

        <AppButton
          disabled={!canConfirm}
          label="确认记入账本"
          onPress={onConfirm}
          style={styles.reviewPrimaryButton}
        />
        <AppButton label="重新选择图片" onPress={onRetry} variant="text" />
      </ScrollView>
    </>
  );
}

function MonthlyReport({
  expense,
  income,
  onClose,
}: {
  expense: number;
  income: number;
  onClose: () => void;
}) {
  const balance = income - expense;
  const maxWeek = Math.max(...weeklySpend);

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible>
      <ModalSheet maxHeight="94%" onClose={onClose}>
        <View style={styles.reportHeader}>
          <View>
            <Text accessibilityRole="header" style={styles.reportTitle}>8月月报</Text>
            <Text style={styles.sheetSubtitle}>8月1日—8月18日</Text>
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
          <Text style={styles.reportPrimaryValue}>¥{formatAmount(expense)}</Text>
          <View style={styles.reportMetricRow}>
            <View style={styles.reportMetric}>
              <Text style={styles.reportMetricLabel}>本月收入</Text>
              <Text style={styles.reportMetricValue}>¥{formatAmount(income)}</Text>
            </View>
            <View style={styles.reportMetric}>
              <Text style={styles.reportMetricLabel}>本月结余</Text>
              <Text style={styles.reportMetricValue}>¥{formatAmount(balance)}</Text>
            </View>
          </View>

          <View style={styles.reportSection}>
            <View style={styles.reportSectionHeader}>
              <Text style={styles.reportSectionTitle}>每周支出</Text>
              <Text style={styles.reportSectionMeta}>较上月同期少 8%</Text>
            </View>
            <View style={styles.weekChart}>
              {weeklySpend.map((value, index) => (
                <View key={`${value}-${index}`} style={styles.weekColumn}>
                  <View style={styles.weekBarTrack}>
                    <View
                      style={[
                        styles.weekBar,
                        { height: Math.max(16, Math.round((value / maxWeek) * 84)) },
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
            <View style={styles.categoryReportList}>
              {categoryReport.map((item) => (
                <View key={item.label} style={styles.categoryReportRow}>
                  <View style={styles.categoryReportTopline}>
                    <View style={styles.categoryReportName}>
                      <AppIcon color={colors.primaryStrong} name={item.icon} size={17} />
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
          </View>

          <View style={styles.reportSection}>
            <Text style={styles.reportSectionTitle}>本月变化</Text>
            <View style={styles.insightList}>
              <View style={styles.insightRow}>
                <View style={styles.insightIcon}>
                  <AppIcon color={colors.primaryStrong} name="restaurant-outline" size={18} />
                </View>
                <Text style={styles.insightText}>餐饮是本月最大支出，占总支出的 35%</Text>
              </View>
              <View style={styles.insightRow}>
                <View style={styles.insightIcon}>
                  <AppIcon color={colors.primaryStrong} name="trending-down-outline" size={18} />
                </View>
                <Text style={styles.insightText}>交通支出较上月同期减少 18%</Text>
              </View>
            </View>
          </View>
        </ScrollView>
      </ModalSheet>
    </Modal>
  );
}

export function LedgerContent() {
  const ledger = useBuiltinTracker('ledger', { limit: 100 });
  const entries = useMemo<LedgerEntry[]>(
    () => ledger.records.map(toLedgerEntry),
    [ledger.records],
  );
  const [entryType, setEntryType] = useState<LedgerEntryType>('expense');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [category, setCategory] = useState('餐饮');
  const [manualOpen, setManualOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanStep, setScanStep] = useState<ScanStep>('source');
  const [recognizedAmount, setRecognizedAmount] = useState('86.40');
  const [recognizedMerchant, setRecognizedMerchant] = useState('盒马鲜生');
  const [recognizedCategory, setRecognizedCategory] = useState('餐饮');
  const [reportOpen, setReportOpen] = useState(false);

  useEffect(() => {
    if (scanStep !== 'processing') return undefined;
    const timer = setTimeout(() => setScanStep('review'), 720);
    return () => clearTimeout(timer);
  }, [scanStep]);

  const currentCategoryOptions = entryType === 'expense' ? expenseCategories : incomeCategories;
  const parsedAmount = Number(amount);
  const canSave = Number.isFinite(parsedAmount) && parsedAmount > 0;
  // 统计只算真实记录，不叠一个编出来的基数。
  const monthExpense = useMemo(
    () =>
      entries
        .filter((entry) => entry.type === 'expense')
        .reduce((total, entry) => total + entry.amount, 0),
    [entries],
  );
  const monthIncome = useMemo(
    () =>
      entries
        .filter((entry) => entry.type === 'income')
        .reduce((total, entry) => total + entry.amount, 0),
    [entries],
  );
  const monthBalance = monthIncome - monthExpense;
  const budget = 6000;
  const budgetRatio = Math.min(1, monthExpense / budget);

  const closeScan = () => {
    setScanOpen(false);
    setScanStep('source');
  };

  const changeEntryType = (index: number) => {
    const nextType: LedgerEntryType = index === 0 ? 'expense' : 'income';
    setEntryType(nextType);
    setCategory(nextType === 'expense' ? expenseCategories[0].label : incomeCategories[0].label);
  };

  const saveManualEntry = () => {
    if (!canSave) return;
    ledger.save(
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
  };

  const confirmRecognizedEntry = () => {
    const parsedRecognizedAmount = Number(recognizedAmount);
    if (!Number.isFinite(parsedRecognizedAmount) || parsedRecognizedAmount <= 0) return;
    // 识别结果只是候选：走到这里说明用户已经在确认页看过并点了确认。
    ledger.save(
      {
        amount: parsedRecognizedAmount,
        direction: 'expense',
        category: recognizedCategory,
        merchant: recognizedMerchant.trim() || undefined,
        payment_method: '微信支付',
      },
      new Date(),
    );
    closeScan();
  };

  return (
    <>
      <View style={styles.overview}>
        <View style={styles.overviewHeader}>
          <View>
            <Text style={styles.overviewPeriod}>8月账本</Text>
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
        <Text style={styles.overviewPrimaryValue}>¥{formatAmount(monthExpense)}</Text>
        <View style={styles.overviewMetrics}>
          <View style={styles.overviewMetric}>
            <Text style={styles.overviewMetricLabel}>本月收入</Text>
            <Text style={styles.overviewMetricValue}>¥{formatAmount(monthIncome)}</Text>
          </View>
          <View style={styles.overviewMetric}>
            <Text style={styles.overviewMetricLabel}>本月结余</Text>
            <Text style={styles.overviewMetricValue}>¥{formatAmount(monthBalance)}</Text>
          </View>
        </View>
        <View style={styles.budgetTopline}>
          <Text style={styles.budgetLabel}>月预算 ¥{formatAmount(budget)}</Text>
          <Text style={styles.budgetRemaining}>
            还可支出 ¥{formatAmount(Math.max(0, budget - monthExpense))}
          </Text>
        </View>
        <View style={styles.budgetTrack}>
          <View style={[styles.budgetFill, { width: `${Math.round(budgetRatio * 100)}%` }]} />
        </View>
      </View>

      <View style={styles.actionRow}>
        <ActionButton
          icon="camera-outline"
          label="拍照记账"
          onPress={() => {
            setScanOpen(true);
            setScanStep('source');
          }}
          primary
        />
        <ActionButton
          icon={manualOpen ? 'close' : 'add'}
          label={manualOpen ? '收起' : '手动记账'}
          onPress={() => setManualOpen((current) => !current)}
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
          <AppButton disabled={!canSave} label="保存这笔记录" onPress={saveManualEntry} />
        </View>
      ) : null}

      <View style={styles.listHeader}>
        <Text accessibilityRole="header" style={styles.listTitle}>最近账单</Text>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.allBillsLink, pressed && styles.rowPressed]}
        >
          <Text style={styles.allBillsText}>全部账单</Text>
          <AppIcon color={colors.textSecondary} name="chevron-forward" size={15} />
        </Pressable>
      </View>
      <View style={styles.entryList}>
        {entries.slice(0, 5).map((entry) => (
          <LedgerRow entry={entry} key={entry.id} />
        ))}
      </View>

      <Modal animationType="fade" onRequestClose={closeScan} transparent visible={scanOpen}>
        <ModalSheet maxHeight="90%" onClose={closeScan}>
          {scanStep === 'source' ? <ScanSource onSelect={() => setScanStep('processing')} /> : null}
          {scanStep === 'processing' ? <ScanProcessing /> : null}
          {scanStep === 'review' ? (
            <ScanReview
              amount={recognizedAmount}
              category={recognizedCategory}
              merchant={recognizedMerchant}
              onAmountChange={setRecognizedAmount}
              onCategoryChange={setRecognizedCategory}
              onConfirm={confirmRecognizedEntry}
              onMerchantChange={setRecognizedMerchant}
              onRetry={() => setScanStep('source')}
            />
          ) : null}
        </ModalSheet>
      </Modal>

      {reportOpen ? (
        <MonthlyReport
          expense={monthExpense}
          income={monthIncome}
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
  budgetTopline: {
    marginTop: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  budgetLabel: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  budgetRemaining: {
    color: colors.text,
    fontFamily,
    ...typography.meta,
    fontWeight: '500',
  },
  budgetTrack: {
    height: 6,
    marginTop: 9,
    overflow: 'hidden',
    borderRadius: radius.pill,
    backgroundColor: colors.border,
  },
  budgetFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
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
  sheetHeader: {
    minHeight: 76,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: {
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  sheetSubtitle: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  sourceActions: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  sourceRow: {
    minHeight: 72,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sourceIcon: {
    width: 44,
    height: 44,
    marginRight: 12,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  sourceCopy: {
    flex: 1,
    minWidth: 0,
  },
  sourceTitle: {
    color: colors.text,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  sourceMeta: {
    marginTop: 3,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  processingBody: {
    minHeight: 340,
    paddingHorizontal: 24,
    paddingBottom: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiptPreview: {
    width: 176,
    height: 154,
    padding: 20,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  receiptIcon: {
    width: 44,
    height: 44,
    marginBottom: 16,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  skeletonLine: {
    height: 7,
    marginTop: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
  },
  skeletonLineWide: {
    width: '100%',
  },
  skeletonLineMedium: {
    width: '72%',
  },
  skeletonLineShort: {
    width: '46%',
  },
  processingTitle: {
    marginTop: 23,
    color: colors.text,
    fontFamily,
    ...typography.bodyStrong,
  },
  processingCopy: {
    marginTop: 4,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  recognizedBadge: {
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.primarySoft,
  },
  recognizedBadgeText: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.meta,
    fontWeight: '600',
  },
  reviewBody: {
    paddingHorizontal: 20,
    paddingBottom: 22,
  },
  recognizedSource: {
    minHeight: 64,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSubtle,
  },
  recognizedSourceIcon: {
    width: 40,
    height: 40,
    marginRight: 11,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  reviewAmountField: {
    minHeight: 68,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSubtle,
  },
  reviewCurrency: {
    color: colors.text,
    fontFamily,
    fontSize: 21,
    lineHeight: 29,
    fontWeight: '600',
  },
  reviewAmountInput: {
    flex: 1,
    minHeight: 60,
    paddingHorizontal: 9,
    color: colors.text,
    fontFamily,
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  reviewTextInput: {
    minHeight: 50,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    color: colors.text,
    fontFamily,
    ...typography.body,
    backgroundColor: colors.surfaceSubtle,
  },
  reviewPrimaryButton: {
    marginTop: 22,
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
});

/** 把一条记录映射成展示模型。 */
function toLedgerEntry(row: TrackerRecord): LedgerEntry {
  const category = textOf(row, 'category') ?? '其他';
  return {
    id: row.id,
    title: textOf(row, 'merchant') ?? category,
    category,
    amount: numberOf(row, 'amount') ?? 0,
    type: (textOf(row, 'direction') as LedgerEntryType | undefined) ?? 'expense',
    time: formatRelativeTime(row.timestamp),
    account: textOf(row, 'payment_method') ?? '默认账户',
  };
}
