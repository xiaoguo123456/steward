import {
  createTask,
  errorMessage,
  useGetPerson,
  useListTaskLists,
  type TaskPriority,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppScreen } from '@/components/ui/app-screen';
import { DateWheel } from '@/components/ui/date-wheel';
import { AppIcon } from '@/components/ui/icon';
import { ModalSheet } from '@/components/ui/modal-sheet';
import { TimeWheel } from '@/components/ui/time-wheel';
import { buildManualTaskRequest } from '@/features/tasks/manual-task-request';
import { dayOfReminder, useTaskReminder } from '@/features/tasks/use-task-reminder';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';
import { formatDateParam, formatMonthDay } from '@/utils/format';

const priorities: { value: TaskPriority; label: string }[] = [
  { value: 'low', label: '低' },
  { value: 'normal', label: '普通' },
  { value: 'high', label: '高' },
];

type Picker = 'due' | 'reminder' | 'priority' | 'list' | null;

export default function NewTaskScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ entry?: string; listId?: string; personId?: string }>();
  const queryClient = useQueryClient();
  const listsQuery = useListTaskLists({ list_kind: 'tasks' });
  const personID = params.personId?.trim() || null;
  const personQuery = useGetPerson(personID ?? '', { query: { enabled: Boolean(personID) } });
  const reminder = useTaskReminder();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [remind, setRemind] = useState(false);
  const [reminderTime, setReminderTime] = useState<string | null>(null);
  const [focusToday, setFocusToday] = useState(() => params.entry === 'today');
  const [pickedListId, setPickedListId] = useState<string | null>(
    () => params.listId?.trim() || null,
  );
  const [picker, setPicker] = useState<Picker>(null);
  const [draftDueDate, setDraftDueDate] = useState(() => formatDateParam(new Date()));
  const [draftReminderTime, setDraftReminderTime] = useState(reminder.defaultTime);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lists = useMemo(() => listsQuery.data?.data ?? [], [listsQuery.data]);
  const defaultListId = lists.find((list) => list.is_default)?.id ?? lists[0]?.id ?? null;
  const listId = lists.some((list) => list.id === pickedListId) ? pickedListId : defaultListId;
  const selectedList = lists.find((list) => list.id === listId) ?? null;
  const selectedReminderTime = reminderTime ?? reminder.defaultTime;
  const person = personQuery.data?.data;
  const personReady = !personID || Boolean(person);
  const canSave = title.trim().length > 0 && Boolean(listId) && personReady && !saving;

  const openDuePicker = () => {
    setDraftDueDate(dueDate ?? formatDateParam(new Date()));
    setPicker('due');
  };

  const openReminderPicker = () => {
    setDraftReminderTime(selectedReminderTime);
    setPicker('reminder');
  };

  const save = async () => {
    if (!canSave || !listId) return;
    setError(null);
    setSaving(true);
    try {
      const body = buildManualTaskRequest({
        title,
        description,
        priority,
        listId,
        personId: person?.id,
        focusDate: focusToday ? formatDateParam(new Date()) : undefined,
        // 只给日期不给时刻：提醒时间属于 Reminder，不把截止日期补成虚构时刻。
        dueDate: dueDate ?? undefined,
        dueTimezone: dueDate
          ? Intl.DateTimeFormat().resolvedOptions().timeZone
          : undefined,
        reminders: dueDate && remind ? [dayOfReminder(selectedReminderTime)] : undefined,
      });

      await createTask(body);
      await queryClient.invalidateQueries();
      router.back();
    } catch (err) {
      setError(errorMessage(err, '保存失败，请稍后重试。'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppScreen includeBottomInset>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="取消新建任务"
          accessibilityRole="button"
          hitSlop={10}
          onPress={() => router.back()}
          style={styles.headerSide}
        >
          <Text style={styles.cancel}>取消</Text>
        </Pressable>
        <Text accessibilityRole="header" style={styles.headerTitle}>新建任务</Text>
        <Pressable
          accessibilityLabel="保存任务"
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSave }}
          disabled={!canSave}
          hitSlop={10}
          onPress={() => void save()}
          style={[styles.headerSide, styles.headerRight]}
        >
          <Text style={[styles.save, !canSave && styles.saveDisabled]}>
            {saving ? '保存中' : '保存'}
          </Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.body}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.editor}>
            <TextInput
              accessibilityLabel="任务标题"
              autoFocus
              maxLength={200}
              onChangeText={setTitle}
              placeholder="要做什么？"
              placeholderTextColor={colors.textSecondary}
              returnKeyType="next"
              selectionColor={colors.primary}
              style={styles.titleInput}
              value={title}
            />
            <View style={styles.editorDivider} />
            <TextInput
              accessibilityLabel="备注"
              multiline
              onChangeText={setDescription}
              placeholder="添加备注"
              placeholderTextColor={colors.textSecondary}
              selectionColor={colors.primary}
              style={styles.noteInput}
              textAlignVertical="top"
              value={description}
            />
          </View>

          <Text style={styles.sectionLabel}>安排</Text>
          <View style={styles.settingGroup}>
            <SettingRow
              icon="sunny-outline"
              label="加入今天"
              trailing={(
                <Switch
                  accessibilityLabel="加入今天"
                  onValueChange={setFocusToday}
                  thumbColor={colors.background}
                  trackColor={{ false: colors.borderStrong, true: colors.primary }}
                  value={focusToday}
                />
              )}
            />
            <SettingDivider />
            <SettingRow
              icon="calendar-outline"
              label="截止日期"
              onPress={openDuePicker}
              value={formatDueDateLabel(dueDate)}
            />
            {dueDate ? (
              <>
                <SettingDivider />
                <SettingRow
                  icon="alarm-outline"
                  label="到期提醒"
                  trailing={(
                    <Switch
                      accessibilityLabel="到期提醒"
                      onValueChange={setRemind}
                      thumbColor={colors.background}
                      trackColor={{ false: colors.borderStrong, true: colors.primary }}
                      value={remind}
                    />
                  )}
                />
                {remind ? (
                  <>
                    <SettingDivider />
                    <SettingRow
                      icon="time-outline"
                      label="提醒时间"
                      onPress={openReminderPicker}
                      value={`当天 ${selectedReminderTime}`}
                    />
                  </>
                ) : null}
              </>
            ) : null}
          </View>

          <Text style={styles.sectionLabel}>其他</Text>
          <View style={styles.settingGroup}>
            <SettingRow
              icon="flag-outline"
              label="优先级"
              onPress={() => setPicker('priority')}
              value={priorityLabel(priority)}
            />
            <SettingDivider />
            {personID ? (
              <>
                <SettingRow
                  icon="person-outline"
                  label="亲友"
                  value={person?.name ?? (personQuery.isPending ? '加载中' : '不可用')}
                />
                <SettingDivider />
              </>
            ) : null}
            <SettingRow
              disabled={lists.length === 0}
              icon="list-outline"
              label="清单"
              onPress={() => setPicker('list')}
              value={selectedList?.name ?? (listsQuery.isPending ? '加载中' : '未选择')}
            />
          </View>

          {listsQuery.isError ? (
            <Text style={styles.error}>暂时无法加载清单，请稍后重试。</Text>
          ) : null}
          {personQuery.isError ? (
            <Text style={styles.error}>暂时无法关联这位亲友，请返回后重试。</Text>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <DatePickerSheet
        onChange={setDraftDueDate}
        onClear={() => {
          setDueDate(null);
          setRemind(false);
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
        onConfirm={() => {
          setDueDate(draftDueDate);
          setPicker(null);
        }}
        value={draftDueDate}
        visible={picker === 'due'}
      />
      <TimePickerSheet
        onChange={setDraftReminderTime}
        onClose={() => setPicker(null)}
        onConfirm={() => {
          setReminderTime(draftReminderTime);
          setPicker(null);
        }}
        value={draftReminderTime}
        visible={picker === 'reminder'}
      />
      <OptionSheet
        onClose={() => setPicker(null)}
        onSelect={(value) => setPriority(value)}
        options={priorities}
        title="优先级"
        value={priority}
        visible={picker === 'priority'}
      />
      <OptionSheet
        onClose={() => setPicker(null)}
        onSelect={setPickedListId}
        options={lists.map((list) => ({ value: list.id, label: list.name }))}
        title="选择清单"
        value={listId ?? ''}
        visible={picker === 'list'}
      />
    </AppScreen>
  );
}

function SettingRow({
  disabled = false,
  icon,
  label,
  onPress,
  trailing,
  value,
}: {
  disabled?: boolean;
  icon: React.ComponentProps<typeof AppIcon>['name'];
  label: string;
  onPress?: () => void;
  trailing?: ReactNode;
  value?: string;
}) {
  const content = (
    <>
      <View style={styles.settingIcon}>
        <AppIcon color={colors.primaryStrong} name={icon} size={18} />
      </View>
      <Text style={styles.settingLabel}>{label}</Text>
      <View style={styles.settingTrailing}>
        {value ? <Text numberOfLines={1} style={styles.settingValue}>{value}</Text> : null}
        {trailing}
        {onPress ? <AppIcon color={colors.textTertiary} name="chevron-forward" size={17} /> : null}
      </View>
    </>
  );

  if (!onPress) return <View style={styles.settingRow}>{content}</View>;
  return (
    <Pressable
      accessibilityLabel={`${label}，${value ?? ''}`}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.settingRow,
        disabled && styles.disabled,
        pressed && styles.settingRowPressed,
      ]}
    >
      {content}
    </Pressable>
  );
}

function SettingDivider() {
  return <View style={styles.settingDivider} />;
}

function DatePickerSheet({
  onChange,
  onClear,
  onClose,
  onConfirm,
  value,
  visible,
}: {
  onChange: (value: string) => void;
  onClear: () => void;
  onClose: () => void;
  onConfirm: () => void;
  value: string;
  visible: boolean;
}) {
  const today = formatDateParam(new Date());
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = formatDateParam(tomorrowDate);

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <ModalSheet maxHeight="70%" onClose={onClose}>
        <SheetHeader onClose={onClose} title="截止日期" />
        <View style={styles.quickDateRow}>
          <QuickDate label="今天" onPress={() => onChange(today)} selected={value === today} />
          <QuickDate label="明天" onPress={() => onChange(tomorrow)} selected={value === tomorrow} />
        </View>
        <View style={styles.wheelArea}>
          <DateWheel
            endYear={new Date().getFullYear() + 10}
            onChange={onChange}
            startYear={new Date().getFullYear() - 1}
            value={value}
          />
        </View>
        <View style={styles.sheetFooterRow}>
          <AppButton label="不设置" onPress={onClear} style={styles.sheetFooterButton} variant="text" />
          <AppButton label="确定" onPress={onConfirm} style={styles.sheetFooterButton} />
        </View>
      </ModalSheet>
    </Modal>
  );
}

function TimePickerSheet({
  onChange,
  onClose,
  onConfirm,
  value,
  visible,
}: {
  onChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  value: string;
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
      <ModalSheet maxHeight="58%" onClose={onClose}>
        <SheetHeader onClose={onClose} title="到期当天提醒" />
        <View style={styles.wheelArea}>
          <TimeWheel onChange={onChange} value={value} />
        </View>
        <View style={styles.sheetFooter}>
          <AppButton label="确定" onPress={onConfirm} />
        </View>
      </ModalSheet>
    </Modal>
  );
}

function OptionSheet<Value extends string>({
  onClose,
  onSelect,
  options,
  title,
  value,
  visible,
}: {
  onClose: () => void;
  onSelect: (value: Value) => void;
  options: { value: Value; label: string }[];
  title: string;
  value: Value;
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
      <ModalSheet maxHeight="68%" onClose={onClose}>
        <SheetHeader onClose={onClose} title={title} />
        <ScrollView contentContainerStyle={styles.optionList}>
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={option.value}
                onPress={() => {
                  onSelect(option.value);
                  onClose();
                }}
                style={({ pressed }) => [
                  styles.optionRow,
                  selected && styles.optionRowSelected,
                  pressed && styles.settingRowPressed,
                ]}
              >
                <Text style={[styles.optionText, selected && styles.optionTextSelected]}>
                  {option.label}
                </Text>
                {selected ? (
                  <AppIcon color={colors.primaryStrong} name="checkmark" size={18} />
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </ModalSheet>
    </Modal>
  );
}

function SheetHeader({ onClose, title }: { onClose: () => void; title: string }) {
  return (
    <View style={styles.sheetHeader}>
      <Text accessibilityRole="header" style={styles.sheetTitle}>{title}</Text>
      <Pressable
        accessibilityLabel={`关闭${title}`}
        accessibilityRole="button"
        onPress={onClose}
        style={({ pressed }) => [styles.sheetClose, pressed && styles.settingRowPressed]}
      >
        <AppIcon color={colors.text} name="close" size={22} />
      </Pressable>
    </View>
  );
}

function QuickDate({
  label,
  onPress,
  selected,
}: {
  label: string;
  onPress: () => void;
  selected: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.quickDate,
        selected && styles.quickDateSelected,
        pressed && styles.settingRowPressed,
      ]}
    >
      <Text style={[styles.quickDateText, selected && styles.quickDateTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function priorityLabel(priority: TaskPriority): string {
  return priorities.find((item) => item.value === priority)?.label ?? '普通';
}

function formatDueDateLabel(value: string | null): string {
  if (!value) return '未设置';
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (value === formatDateParam(today)) return '今天';
  if (value === formatDateParam(tomorrow)) return '明天';
  return formatMonthDay(value);
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
  header: {
    height: 52,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerSide: {
    width: 72,
    minHeight: 44,
    justifyContent: 'center',
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  headerTitle: {
    flex: 1,
    color: colors.text,
    fontFamily,
    ...typography.section,
    textAlign: 'center',
  },
  cancel: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
  },
  save: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.bodyStrong,
  },
  saveDisabled: {
    color: colors.textTertiary,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 40,
  },
  editor: {
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  titleInput: {
    minHeight: 58,
    color: colors.text,
    fontFamily,
    fontSize: 19,
    lineHeight: 27,
    fontWeight: '600',
  },
  editorDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  noteInput: {
    minHeight: 72,
    paddingTop: 13,
    paddingBottom: 13,
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  sectionLabel: {
    marginTop: 20,
    marginBottom: 8,
    marginLeft: 4,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    fontWeight: '600',
  },
  settingGroup: {
    overflow: 'hidden',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  settingRow: {
    minHeight: 58,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  settingRowPressed: {
    backgroundColor: colors.surface,
  },
  settingIcon: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
  },
  settingLabel: {
    flex: 1,
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  settingTrailing: {
    maxWidth: '54%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  settingValue: {
    flexShrink: 1,
    color: colors.textSecondary,
    fontFamily,
    ...typography.label,
  },
  settingDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 54,
    backgroundColor: colors.border,
  },
  disabled: {
    opacity: 0.48,
  },
  error: {
    marginTop: 14,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  sheetHeader: {
    minHeight: 60,
    paddingLeft: 20,
    paddingRight: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: {
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  sheetClose: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  quickDateRow: {
    paddingHorizontal: 20,
    flexDirection: 'row',
    gap: 8,
  },
  quickDate: {
    minHeight: 40,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  quickDateSelected: {
    backgroundColor: colors.primarySoft,
  },
  quickDateText: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.label,
  },
  quickDateTextSelected: {
    color: colors.primaryStrong,
    fontWeight: '600',
  },
  wheelArea: {
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  sheetFooter: {
    padding: 20,
  },
  sheetFooterRow: {
    padding: 20,
    flexDirection: 'row',
    gap: 10,
  },
  sheetFooterButton: {
    flex: 1,
  },
  optionList: {
    paddingHorizontal: 16,
    paddingBottom: 20,
    gap: 4,
  },
  optionRow: {
    minHeight: 52,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.md,
  },
  optionRowSelected: {
    backgroundColor: colors.primarySoft,
  },
  optionText: {
    minWidth: 0,
    flex: 1,
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  optionTextSelected: {
    color: colors.primaryStrong,
    fontWeight: '600',
  },
});
