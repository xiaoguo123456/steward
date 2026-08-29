import {
  errorMessage,
  useCreateEvent,
  useGetImportantDates,
  type ImportantDateEntry,
  type Reminder,
  type ReminderInput,
} from '@steward/api-client';
import type { ComponentProps } from 'react';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
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
import { DateWheel } from '@/components/ui/date-wheel';
import { AppIcon } from '@/components/ui/icon';
import { ModalSheet } from '@/components/ui/modal-sheet';
import { StatePanel } from '@/components/ui/state-panel';
import {
  parseImportantDateParts,
} from '@/features/important-dates/important-date-picker';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

type ImportantDateKind = 'birthday' | 'anniversary' | 'expiry' | 'other';
type ReminderValue = 'seven-days' | 'one-day' | 'same-day';
type IconName = ComponentProps<typeof AppIcon>['name'];

/**
 * 展示用的视图模型。
 *
 * 它不是网络 DTO：下一次发生日期、剩余天数和排序都由服务端算好
 * （年度投影、2 月 29 日、时区都在那边），这里只负责渲染。
 */
type ImportantDateItem = {
  id: string;
  version: number;
  title: string;
  kind: ImportantDateKind;
  /** 原始月日，详情里展示的是它，不是投影后的日期。 */
  date: string;
  repeatYearly: boolean;
  reminders: ReminderValue[];
  /** 服务端算出的下一次发生日期。 */
  nextOccurrence: string;
  /** 服务端算出的剩余天数。今天为 0，已过期为负。 */
  daysUntil: number;
};

/** 新增面板产出的草稿。它不是网络 DTO，由上层映射成 Event 请求。 */
type ImportantDateDraft = Pick<
  ImportantDateItem,
  'title' | 'kind' | 'date' | 'repeatYearly' | 'reminders'
>;

type KindSpec = {
  label: string;
  icon: IconName;
  color: string;
  soft: string;
  placeholder: string;
};

const kindSpecs: Record<ImportantDateKind, KindSpec> = {
  birthday: {
    label: '生日',
    icon: 'gift-outline',
    color: '#B84A70',
    soft: '#FDEFF4',
    placeholder: '例如：妈妈生日',
  },
  anniversary: {
    label: '纪念日',
    icon: 'heart-outline',
    color: '#C25A4B',
    soft: '#FFF0EC',
    placeholder: '例如：结婚纪念日',
  },
  expiry: {
    label: '到期日',
    icon: 'document-text-outline',
    color: '#A66B12',
    soft: '#FFF5DE',
    placeholder: '例如：护照到期',
  },
  other: {
    label: '其他',
    icon: 'calendar-outline',
    color: colors.primaryStrong,
    soft: colors.primarySoft,
    placeholder: '例如：搬家纪念日',
  },
};

const reminderOptions: { value: ReminderValue; label: string }[] = [
  { value: 'seven-days', label: '7 天前' },
  { value: 'one-day', label: '1 天前' },
  { value: 'same-day', label: '当天' },
];


function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function parseDate(value: string) {
  const { year, month, day } = parseImportantDateParts(value);
  return new Date(year, month - 1, day);
}

function toIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function getDaysUntil(item: ImportantDateItem) {
  return item.daysUntil;
}

/** 把服务端的投影结果映射成展示模型。 */
function toItem(entry: ImportantDateEntry): ImportantDateItem {
  const event = entry.event;
  const date = event.start_date ?? entry.next_occurrence_date;
  return {
    id: event.id,
    version: event.version,
    title: event.title,
    kind: event.important_date_kind ?? 'other',
    date,
    repeatYearly: event.recurrence === 'yearly',
    reminders: toReminderValues(event.reminders),
    nextOccurrence: entry.next_occurrence_date,
    daysUntil: entry.days_until,
  };
}

/** 全天提醒用「提前几天 + 当地时刻」表达，这里还原成三个预设。 */
function toReminderValues(reminders: Reminder[] | undefined): ReminderValue[] {
  const out: ReminderValue[] = [];
  for (const reminder of reminders ?? []) {
    if (reminder.kind !== 'absolute_local') continue;
    if (reminder.days_before === 7) out.push('seven-days');
    else if (reminder.days_before === 1) out.push('one-day');
    else if (reminder.days_before === 0) out.push('same-day');
  }
  return out;
}

/** 反向映射：预设 → 契约里的提醒输入。 */
function toReminderInputs(values: ReminderValue[]): ReminderInput[] {
  const daysBefore: Record<ReminderValue, number> = {
    'seven-days': 7,
    'one-day': 1,
    'same-day': 0,
  };
  return values.map((value) => ({
    kind: 'absolute_local' as const,
    // 全天提醒必须写明当地触发时刻，交互上固定为 09:00。
    local_time: '09:00',
    days_before: daysBefore[value],
  }));
}

function formatDateLabel(item: ImportantDateItem) {
  const date = parseDate(item.date);
  if (item.repeatYearly) return `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatCountdown(days: number) {
  if (days < 0) return '已过期';
  if (days === 0) return '今天';
  if (days === 1) return '明天';
  return `${days} 天后`;
}

function formatReminderSummary(reminders: ReminderValue[]) {
  if (reminders.length === 0) return '不提醒';
  return reminderOptions
    .filter((option) => reminders.includes(option.value))
    .map((option) => option.label)
    .join('、');
}

function KindIcon({ kind, size = 20 }: { kind: ImportantDateKind; size?: number }) {
  const spec = kindSpecs[kind];
  return (
    <View style={[styles.kindIcon, { backgroundColor: spec.soft }]}>
      <AppIcon color={spec.color} name={spec.icon} size={size} />
    </View>
  );
}

function ImportantDateRow({
  item,
  onPress,
}: {
  item: ImportantDateItem;
  onPress: () => void;
}) {
  const days = getDaysUntil(item);
  const spec = kindSpecs[item.kind];

  return (
    <Pressable
      accessibilityLabel={`${item.title}，${formatDateLabel(item)}，${formatCountdown(days)}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.dateRow, pressed && styles.pressed]}
    >
      <KindIcon kind={item.kind} />
      <View style={styles.rowCopy}>
        <Text numberOfLines={1} style={styles.rowTitle}>{item.title}</Text>
        <Text style={styles.rowMeta}>
          {formatDateLabel(item)}{item.repeatYearly ? ' · 每年' : ''}
        </Text>
      </View>
      <View style={styles.rowCountdown}>
        <Text style={[styles.rowCountdownValue, { color: spec.color }]}>
          {formatCountdown(days)}
        </Text>
        <AppIcon color={colors.textTertiary} name="chevron-forward" size={15} />
      </View>
    </Pressable>
  );
}

function CreateSheet({
  visible,
  onClose,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (draft: ImportantDateDraft) => void;
  saving: boolean;
}) {
  const initialDate = useMemo(() => addDays(startOfToday(), 30), []);
  const [kind, setKind] = useState<ImportantDateKind>('birthday');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(toIsoDate(initialDate));
  const [repeatYearly, setRepeatYearly] = useState(true);
  const [reminders, setReminders] = useState<ReminderValue[]>(['seven-days', 'same-day']);

  const selectKind = (nextKind: ImportantDateKind) => {
    setKind(nextKind);
    setRepeatYearly(nextKind === 'birthday' || nextKind === 'anniversary');
  };

  const toggleReminder = (value: ReminderValue) => {
    setReminders((current) =>
      current.includes(value)
        ? current.filter((reminder) => reminder !== value)
        : [...current, value],
    );
  };

  const save = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    onSave({ title: trimmedTitle, kind, date, repeatYearly, reminders });
    setTitle('');
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <ModalSheet maxHeight="94%" onClose={onClose}>
        <View style={styles.createSheetLayout}>
          <ScrollView
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            style={styles.createSheetScroll}
          >
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderCopy}>
                <Text accessibilityRole="header" style={styles.sheetTitle}>新增重要日</Text>
              </View>
              <Pressable
                accessibilityLabel="关闭新增重要日"
                accessibilityRole="button"
                onPress={onClose}
                style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
              >
                <AppIcon color={colors.text} name="close" size={22} />
              </Pressable>
            </View>

            <Text style={styles.fieldLabel}>类型</Text>
            <View style={styles.kindOptions}>
              {(Object.keys(kindSpecs) as ImportantDateKind[]).map((value) => {
                const spec = kindSpecs[value];
                const selected = kind === value;
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    key={value}
                    onPress={() => selectKind(value)}
                    style={({ pressed }) => [
                      styles.kindOption,
                      selected && styles.kindOptionSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <AppIcon
                      color={selected ? colors.primaryStrong : colors.textSecondary}
                      name={spec.icon}
                      size={18}
                    />
                    <Text style={[styles.kindOptionText, selected && styles.kindOptionTextSelected]}>
                      {spec.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.fieldLabel}>名称</Text>
            <TextInput
              accessibilityLabel="重要日名称"
              maxLength={30}
              onChangeText={setTitle}
              placeholder={kindSpecs[kind].placeholder}
              placeholderTextColor={colors.textTertiary}
              returnKeyType="done"
              selectionColor={colors.primary}
              style={styles.titleInput}
              value={title}
            />

            <Text style={styles.fieldLabel}>日期</Text>
            <DateWheel
              onChange={setDate}
              value={date}
            />

            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: repeatYearly }}
              onPress={() => setRepeatYearly((current) => !current)}
              style={({ pressed }) => [styles.settingRow, pressed && styles.pressed]}
            >
              <View>
                <Text style={styles.settingTitle}>每年重复</Text>
                <Text style={styles.settingMeta}>{repeatYearly ? '已开启' : '仅记录这一次'}</Text>
              </View>
              <View style={[styles.switchTrack, repeatYearly && styles.switchTrackOn]}>
                <View style={[styles.switchThumb, repeatYearly && styles.switchThumbOn]} />
              </View>
            </Pressable>

            <Text style={styles.fieldLabel}>提醒（09:00）</Text>
            <View style={styles.reminderOptions}>
              {reminderOptions.map((option) => {
                const selected = reminders.includes(option.value);
                return (
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                    key={option.value}
                    onPress={() => toggleReminder(option.value)}
                    style={({ pressed }) => [
                      styles.reminderOption,
                      selected && styles.reminderOptionSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    {selected ? (
                      <AppIcon color={colors.primaryStrong} name="checkmark" size={16} />
                    ) : null}
                    <Text
                      style={[
                        styles.reminderOptionText,
                        selected && styles.reminderOptionTextSelected,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          <View style={styles.sheetFooter}>
            <AppButton
              disabled={!title.trim()}
              icon="checkmark"
              label="保存重要日"
              onPress={save}
            />
          </View>
        </View>
      </ModalSheet>
    </Modal>
  );
}

function DetailSheet({
  item,
  onClose,
  onOpenCalendar,
}: {
  item: ImportantDateItem | null;
  onClose: () => void;
  onOpenCalendar: () => void;
}) {
  if (!item) return null;
  const spec = kindSpecs[item.kind];
  const days = getDaysUntil(item);

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={Boolean(item)}
    >
      <ModalSheet maxHeight="66%" onClose={onClose}>
        <View style={styles.detailContent}>
          <View style={styles.detailHeader}>
            <KindIcon kind={item.kind} size={22} />
            <View style={styles.sheetHeaderCopy}>
              <Text accessibilityRole="header" style={styles.detailTitle}>{item.title}</Text>
              <Text style={[styles.detailKind, { color: spec.color }]}>{spec.label}</Text>
            </View>
            <Pressable
              accessibilityLabel="关闭重要日详情"
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
            >
              <AppIcon color={colors.text} name="close" size={22} />
            </Pressable>
          </View>

          <View style={styles.detailCountdown}>
            <Text style={[styles.detailCountdownValue, { color: spec.color }]}>
              {formatCountdown(days)}
            </Text>
            <Text style={styles.detailDate}>{formatDateLabel(item)}</Text>
          </View>

          <View style={styles.detailFacts}>
            <View style={styles.detailFact}>
              <AppIcon color={colors.textSecondary} name="repeat-outline" size={18} />
              <Text style={styles.detailFactText}>
                {item.repeatYearly ? '每年重复' : '不重复'}
              </Text>
            </View>
            <View style={styles.detailFact}>
              <AppIcon color={colors.textSecondary} name="notifications-outline" size={18} />
              <Text style={styles.detailFactText}>
                {formatReminderSummary(item.reminders)} · 09:00
              </Text>
            </View>
          </View>

          <AppButton
            icon="calendar-outline"
            label="在日历中查看"
            onPress={onOpenCalendar}
            style={styles.detailAction}
          />
        </View>
      </ModalSheet>
    </Modal>
  );
}

export function ImportantDatesContent({
  createVisible,
  onCreateVisibleChange,
}: {
  createVisible: boolean;
  onCreateVisibleChange: (visible: boolean) => void;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const importantDates = useGetImportantDates();

  const createEvent = useCreateEvent({
    mutation: {
      onSuccess: () => {
        setFailure(null);
        onCreateVisibleChange(false);
        void importantDates.refetch();
      },
      onError: (error) => setFailure(errorMessage(error, '没能保存这个重要日。')),
    },
  });

  // 服务端已经按下一次发生日期升序返回，客户端不重排。
  const items = (importantDates.data?.data ?? []).map(toItem);
  const nextItem = items[0];
  const laterItems = items.slice(1);
  const selectedItem = items.find((item) => item.id === selectedId) ?? null;

  const saveItem = (draft: ImportantDateDraft) => {
    setFailure(null);
    createEvent.mutate({
      data: {
        title: draft.title,
        event_kind: 'important_date',
        important_date_kind: draft.kind,
        // 重要日一律是全天事件。
        all_day: true,
        start_date: draft.date,
        recurrence: draft.repeatYearly ? 'yearly' : 'none',
        reminders: toReminderInputs(draft.reminders),
      },
    });
  };

  return (
    <>
      <View style={styles.sectionHeader}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>即将到来</Text>
      </View>

      {nextItem ? (
        <Pressable
          accessibilityLabel={`${nextItem.title}，${formatDateLabel(nextItem)}，${formatCountdown(getDaysUntil(nextItem))}`}
          accessibilityRole="button"
          onPress={() => setSelectedId(nextItem.id)}
          style={({ pressed }) => [styles.hero, pressed && styles.pressed]}
        >
          <View style={styles.heroCopy}>
            <KindIcon kind={nextItem.kind} size={22} />
            <View style={styles.heroText}>
              <Text numberOfLines={1} style={styles.heroTitle}>{nextItem.title}</Text>
              <Text style={styles.heroMeta}>
                {formatDateLabel(nextItem)}{nextItem.repeatYearly ? ' · 每年' : ''}
              </Text>
            </View>
          </View>
          <View style={styles.heroCountdown}>
            {getDaysUntil(nextItem) > 1 ? (
              <>
                <Text
                  style={[
                    styles.heroCountdownValue,
                    { color: kindSpecs[nextItem.kind].color },
                  ]}
                >
                  {getDaysUntil(nextItem)}
                </Text>
                <Text
                  style={[
                    styles.heroCountdownUnit,
                    { color: kindSpecs[nextItem.kind].color },
                  ]}
                >
                  天后
                </Text>
              </>
            ) : (
              <Text
                style={[
                  styles.heroCountdownText,
                  { color: kindSpecs[nextItem.kind].color },
                ]}
              >
                {formatCountdown(getDaysUntil(nextItem))}
              </Text>
            )}
          </View>
        </Pressable>
      ) : null}

      {!nextItem && !importantDates.isLoading ? (
        <StatePanel
          actionLabel="添加第一个重要日"
          compact
          icon="gift-outline"
          message="记录生日、纪念日或证件到期日，到时间前再提醒你。"
          onAction={() => onCreateVisibleChange(true)}
          title="还没有重要日"
        />
      ) : null}

      {failure ? <Text style={styles.failureText}>{failure}</Text> : null}

      {laterItems.length > 0 ? (
        <>
          <View style={styles.listHeader}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>更多重要日</Text>
            <Text style={styles.listCount}>{laterItems.length} 项</Text>
          </View>
          <View style={styles.dateList}>
            {laterItems.map((item) => (
              <ImportantDateRow
                item={item}
                key={item.id}
                onPress={() => setSelectedId(item.id)}
              />
            ))}
          </View>
        </>
      ) : null}

      <CreateSheet
        onClose={() => onCreateVisibleChange(false)}
        onSave={saveItem}
        saving={createEvent.isPending}
        visible={createVisible}
      />
      <DetailSheet
        item={selectedItem}
        onClose={() => setSelectedId(null)}
        onOpenCalendar={() => {
          setSelectedId(null);
          router.push('/calendar');
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    minHeight: 48,
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionTitle: {
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  pressed: {
    opacity: 0.7,
  },
  failureText: {
    marginTop: 10,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  hero: {
    minHeight: 112,
    paddingHorizontal: 16,
    paddingVertical: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  heroCopy: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroText: {
    flex: 1,
    minWidth: 0,
    marginLeft: 12,
  },
  heroTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '600',
  },
  heroMeta: {
    marginTop: 4,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  heroCountdown: {
    minWidth: 70,
    marginLeft: 12,
    alignItems: 'flex-end',
  },
  heroCountdownValue: {
    color: '#B84A70',
    fontFamily,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  heroCountdownUnit: {
    marginTop: 1,
    color: '#B84A70',
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
  },
  heroCountdownText: {
    color: '#B84A70',
    fontFamily,
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '700',
  },
  kindIcon: {
    width: 42,
    height: 42,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  listHeader: {
    minHeight: 58,
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  listCount: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    fontVariant: ['tabular-nums'],
  },
  dateList: {
    gap: 8,
  },
  dateRow: {
    minHeight: 70,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
    marginLeft: 12,
  },
  rowTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  rowMeta: {
    marginTop: 3,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
  },
  rowCountdown: {
    marginLeft: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  rowCountdownValue: {
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  createSheetLayout: {
    flexShrink: 1,
  },
  createSheetScroll: {
    flexShrink: 1,
  },
  sheetContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 18,
  },
  sheetHeader: {
    minHeight: 56,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  sheetHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  sheetTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '700',
  },
  closeButton: {
    width: 44,
    height: 44,
    marginTop: -7,
    marginRight: -10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  fieldLabel: {
    marginTop: 18,
    marginBottom: 9,
    color: colors.text,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  kindOptions: {
    flexDirection: 'row',
    gap: 8,
  },
  kindOption: {
    minWidth: 0,
    minHeight: 58,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  kindOptionSelected: {
    backgroundColor: colors.primarySoft,
  },
  kindOptionText: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '500',
  },
  kindOptionTextSelected: {
    color: colors.primaryStrong,
    fontWeight: '600',
  },
  titleInput: {
    minHeight: 52,
    paddingHorizontal: 14,
    color: colors.text,
    fontFamily,
    ...typography.input,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  settingRow: {
    minHeight: 62,
    marginTop: 18,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  settingTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  settingMeta: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
  },
  switchTrack: {
    width: 46,
    height: 28,
    padding: 3,
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
  },
  switchTrackOn: {
    backgroundColor: colors.primary,
  },
  switchThumb: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
  },
  switchThumbOn: {
    alignSelf: 'flex-end',
  },
  reminderOptions: {
    flexDirection: 'row',
    gap: 8,
  },
  reminderOption: {
    minHeight: 44,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  reminderOptionSelected: {
    backgroundColor: colors.primarySoft,
  },
  reminderOptionText: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
  },
  reminderOptionTextSelected: {
    color: colors.primaryStrong,
    fontWeight: '600',
  },
  sheetFooter: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 12,
    backgroundColor: colors.background,
  },
  detailContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
  },
  detailHeader: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  detailTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '700',
  },
  detailKind: {
    marginTop: 2,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
  },
  detailCountdown: {
    minHeight: 94,
    marginTop: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  detailCountdownValue: {
    fontFamily,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  detailDate: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  detailFacts: {
    marginTop: 10,
    gap: 8,
  },
  detailFact: {
    minHeight: 46,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  detailFactText: {
    color: colors.text,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
  },
  detailAction: {
    marginTop: 18,
  },
});
