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
import { AppIcon } from '@/components/ui/icon';
import { ModalSheet } from '@/components/ui/modal-sheet';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

type ImportantDateKind = 'birthday' | 'anniversary' | 'expiry' | 'other';
type ReminderValue = 'seven-days' | 'one-day' | 'same-day';
type IconName = ComponentProps<typeof AppIcon>['name'];

type ImportantDateItem = {
  id: string;
  title: string;
  kind: ImportantDateKind;
  date: string;
  repeatYearly: boolean;
  reminders: ReminderValue[];
};

type KindSpec = {
  label: string;
  icon: IconName;
  color: string;
  soft: string;
  placeholder: string;
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const weekDays = ['日', '一', '二', '三', '四', '五', '六'];

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

const initialImportantDates: ImportantDateItem[] = [
  {
    id: 'mother',
    title: '妈妈生日',
    kind: 'birthday',
    date: '2026-08-24',
    repeatYearly: true,
    reminders: ['seven-days', 'same-day'],
  },
  {
    id: 'anniversary',
    title: '纪念日',
    kind: 'anniversary',
    date: '2026-09-11',
    repeatYearly: true,
    reminders: ['seven-days', 'same-day'],
  },
  {
    id: 'passport',
    title: '护照到期',
    kind: 'expiry',
    date: '2027-03-08',
    repeatYearly: false,
    reminders: ['seven-days', 'one-day'],
  },
];

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function parseDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
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

function createAnnualOccurrence(year: number, month: number, day: number) {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDay));
}

function getNextOccurrence(item: ImportantDateItem, today = startOfToday()) {
  const sourceDate = parseDate(item.date);
  if (!item.repeatYearly) return sourceDate;

  let occurrence = createAnnualOccurrence(
    today.getFullYear(),
    sourceDate.getMonth(),
    sourceDate.getDate(),
  );
  if (occurrence < today) {
    occurrence = createAnnualOccurrence(
      today.getFullYear() + 1,
      sourceDate.getMonth(),
      sourceDate.getDate(),
    );
  }
  return occurrence;
}

function calendarSerial(date: Date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_IN_MS;
}

function getDaysUntil(item: ImportantDateItem) {
  const today = startOfToday();
  return calendarSerial(getNextOccurrence(item, today)) - calendarSerial(today);
}

function formatDateLabel(item: ImportantDateItem) {
  const date = parseDate(item.date);
  if (item.repeatYearly) return `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatSelectedDate(value: string) {
  const date = parseDate(value);
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

function AddButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel="新增重要日"
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
    >
      <AppIcon color={colors.primaryStrong} name="add" size={18} />
      <Text style={styles.addButtonText}>新增</Text>
    </Pressable>
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

function MonthCalendar({
  selectedDate,
  visibleMonth,
  onChangeMonth,
  onSelectDate,
}: {
  selectedDate: string;
  visibleMonth: Date;
  onChangeMonth: (date: Date) => void;
  onSelectDate: (date: string) => void;
}) {
  const calendarDays = useMemo(() => {
    const year = visibleMonth.getFullYear();
    const month = visibleMonth.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (number | null)[] = Array.from({ length: firstWeekday }, () => null);

    for (let day = 1; day <= daysInMonth; day += 1) cells.push(day);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [visibleMonth]);

  const changeMonth = (offset: number) => {
    onChangeMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + offset, 1));
  };

  const todayIso = toIsoDate(startOfToday());

  return (
    <View style={styles.calendarPanel}>
      <View style={styles.calendarHeader}>
        <Pressable
          accessibilityLabel="上个月"
          accessibilityRole="button"
          hitSlop={6}
          onPress={() => changeMonth(-1)}
          style={({ pressed }) => [styles.calendarArrow, pressed && styles.pressed]}
        >
          <AppIcon color={colors.text} name="chevron-back" size={18} />
        </Pressable>
        <Text style={styles.calendarMonth}>
          {visibleMonth.getFullYear()}年{visibleMonth.getMonth() + 1}月
        </Text>
        <Pressable
          accessibilityLabel="下个月"
          accessibilityRole="button"
          hitSlop={6}
          onPress={() => changeMonth(1)}
          style={({ pressed }) => [styles.calendarArrow, pressed && styles.pressed]}
        >
          <AppIcon color={colors.text} name="chevron-forward" size={18} />
        </Pressable>
      </View>

      <View style={styles.calendarGrid}>
        {weekDays.map((day) => (
          <View key={day} style={styles.calendarCell}>
            <Text style={styles.weekdayText}>{day}</Text>
          </View>
        ))}
        {calendarDays.map((day, index) => {
          if (!day) return <View key={`empty-${index}`} style={styles.calendarCell} />;
          const value = toIsoDate(
            new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day),
          );
          const selected = value === selectedDate;
          const isToday = value === todayIso;

          return (
            <View key={value} style={styles.calendarCell}>
              <Pressable
                accessibilityLabel={`${visibleMonth.getMonth() + 1}月${day}日`}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => onSelectDate(value)}
                style={({ pressed }) => [
                  styles.calendarDay,
                  isToday && styles.calendarDayToday,
                  selected && styles.calendarDaySelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.calendarDayText,
                    isToday && styles.calendarDayTextToday,
                    selected && styles.calendarDayTextSelected,
                  ]}
                >
                  {day}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function CreateSheet({
  visible,
  onClose,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (item: ImportantDateItem) => void;
}) {
  const initialDate = useMemo(() => addDays(startOfToday(), 30), []);
  const [kind, setKind] = useState<ImportantDateKind>('birthday');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(toIsoDate(initialDate));
  const [visibleMonth, setVisibleMonth] = useState(
    new Date(initialDate.getFullYear(), initialDate.getMonth(), 1),
  );
  const [repeatYearly, setRepeatYearly] = useState(true);
  const [reminders, setReminders] = useState<ReminderValue[]>(['seven-days', 'same-day']);

  const selectKind = (nextKind: ImportantDateKind) => {
    setKind(nextKind);
    setRepeatYearly(nextKind === 'birthday' || nextKind === 'anniversary');
  };

  const selectDate = (value: string) => {
    setDate(value);
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
    onSave({
      id: `important-date-${Date.now()}`,
      title: trimmedTitle,
      kind,
      date,
      repeatYearly,
      reminders,
    });
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
                <Text style={styles.sheetSubtitle}>设置日期和提醒方式</Text>
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

            <View style={styles.dateLabelRow}>
              <Text style={styles.fieldLabel}>日期</Text>
              <Text style={styles.selectedDateLabel}>{formatSelectedDate(date)}</Text>
            </View>
            <MonthCalendar
              onChangeMonth={setVisibleMonth}
              onSelectDate={selectDate}
              selectedDate={date}
              visibleMonth={visibleMonth}
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

export function ImportantDatesContent() {
  const router = useRouter();
  const [items, setItems] = useState(initialImportantDates);
  const [createVisible, setCreateVisible] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sortedItems = useMemo(
    () =>
      [...items].sort(
        (left, right) =>
          getNextOccurrence(left).getTime() - getNextOccurrence(right).getTime(),
      ),
    [items],
  );
  const nextItem = sortedItems[0];
  const laterItems = sortedItems.slice(1);
  const selectedItem = items.find((item) => item.id === selectedId) ?? null;

  const saveItem = (item: ImportantDateItem) => {
    setItems((current) => [...current, item]);
    setCreateVisible(false);
  };

  return (
    <>
      <View style={styles.sectionHeader}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>下一个重要日</Text>
        <AddButton onPress={() => setCreateVisible(true)} />
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

      <View style={styles.listHeader}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>之后</Text>
        <Text style={styles.listCount}>{laterItems.length} 个</Text>
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

      <CreateSheet
        onClose={() => setCreateVisible(false)}
        onSave={saveItem}
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
    minHeight: 58,
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  addButton: {
    minWidth: 78,
    minHeight: 44,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  addButtonText: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.7,
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
  sheetSubtitle: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
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
  dateLabelRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectedDateLabel: {
    marginTop: 18,
    marginBottom: 9,
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  calendarPanel: {
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 10,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  calendarHeader: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  calendarArrow: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  calendarMonth: {
    color: colors.text,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calendarCell: {
    width: '14.2857%',
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekdayText: {
    color: colors.textTertiary,
    fontFamily,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '500',
  },
  calendarDay: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  calendarDayToday: {
    backgroundColor: colors.primarySoft,
  },
  calendarDaySelected: {
    backgroundColor: colors.primary,
  },
  calendarDayText: {
    color: colors.text,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  calendarDayTextToday: {
    color: colors.primaryStrong,
    fontWeight: '700',
  },
  calendarDayTextSelected: {
    color: colors.background,
    fontWeight: '700',
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
