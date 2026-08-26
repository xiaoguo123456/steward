import {
  errorMessage,
  useCreateEvent,
  type BookingStatus,
  type CreateEventRequest,
  type ItineraryItemKind,
  type TransportMode,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppScreen } from '@/components/ui/app-screen';
import { DateWheel } from '@/components/ui/date-wheel';
import { AppIcon } from '@/components/ui/icon';
import { ModalSheet } from '@/components/ui/modal-sheet';
import { NavHeader } from '@/components/ui/nav-header';
import { TimeWheel } from '@/components/ui/time-wheel';
import { addCalendarDays, formatTripDateWithWeekday, toLocalIsoDate } from '@/features/trips/trip-form';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

type DateTimeField = 'start' | 'end';

const kindLabels: Record<ItineraryItemKind, string> = {
  transport: '交通',
  lodging: '住宿',
  activity: '活动',
};

const transportModes: { value: TransportMode; label: string; icon: React.ComponentProps<typeof AppIcon>['name'] }[] = [
  { value: 'train', label: '火车', icon: 'train-outline' },
  { value: 'flight', label: '飞机', icon: 'airplane-outline' },
  { value: 'coach', label: '客车', icon: 'bus-outline' },
  { value: 'ship', label: '轮船', icon: 'boat-outline' },
  { value: 'self_drive', label: '自驾', icon: 'car-outline' },
  { value: 'other', label: '其他', icon: 'ellipsis-horizontal' },
];

const bookingStatuses: { value: BookingStatus; label: string }[] = [
  { value: 'planned', label: '计划中' },
  { value: 'confirmed', label: '已确认' },
  { value: 'ticketed', label: '已出票' },
];

function DateTimePickerSheet({
  field,
  date,
  time,
  onChangeDate,
  onChangeTime,
  onClose,
}: {
  field: DateTimeField | null;
  date: string;
  time: string;
  onChangeDate: (value: string) => void;
  onChangeTime: (value: string) => void;
  onClose: () => void;
}) {
  const currentYear = new Date().getFullYear();
  return (
    <Modal animationType="fade" onRequestClose={onClose} statusBarTranslucent transparent visible={field !== null}>
      <ModalSheet maxHeight="78%" onClose={onClose}>
        <View style={styles.sheetHeader}>
          <Text accessibilityRole="header" style={styles.sheetTitle}>
            {field === 'start' ? '开始时间' : '结束时间'}
          </Text>
          <Pressable accessibilityLabel="关闭时间选择" onPress={onClose} style={styles.closeButton}>
            <AppIcon name="close" size={22} />
          </Pressable>
        </View>
        <View style={styles.wheelArea}>
          <DateWheel
            endYear={currentYear + 20}
            onChange={onChangeDate}
            startYear={currentYear - 1}
            value={date}
          />
          <TimeWheel onChange={onChangeTime} value={time} />
        </View>
        <View style={styles.sheetFooter}>
          <AppButton label="确定" onPress={onClose} />
        </View>
      </ModalSheet>
    </Modal>
  );
}

function ChoiceChips<Value extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: Value; label: string; icon?: React.ComponentProps<typeof AppIcon>['name'] }[];
  value: Value;
  onChange: (value: Value) => void;
}) {
  return (
    <View style={styles.chips}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            key={option.value}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.chip,
              selected && styles.chipSelected,
              pressed && styles.pressed,
            ]}
          >
            {option.icon ? (
              <AppIcon
                color={selected ? colors.primaryStrong : colors.textSecondary}
                name={option.icon}
                size={17}
              />
            ) : null}
            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function FormField({
  label,
  onChangeText,
  placeholder,
  value,
}: {
  label: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        maxLength={200}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        selectionColor={colors.primary}
        style={styles.input}
        value={value}
      />
    </View>
  );
}

function DateTimeButton({
  label,
  date,
  time,
  onPress,
}: {
  label: string;
  date: string;
  time: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={`${label}，${formatTripDateWithWeekday(date)} ${time}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.dateTimeButton, pressed && styles.pressed]}
    >
      <Text style={styles.dateTimeLabel}>{label}</Text>
      <Text style={styles.dateTimeValue}>{formatTripDateWithWeekday(date)}</Text>
      <Text style={styles.dateTimeClock}>{time}</Text>
    </Pressable>
  );
}

export default function NewTripItemScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{
    projectId?: string;
    kind?: ItineraryItemKind;
    date?: string;
  }>();
  const projectId = params.projectId ?? '';
  const kind: ItineraryItemKind =
    params.kind === 'transport' || params.kind === 'lodging' || params.kind === 'activity'
      ? params.kind
      : 'activity';

  const initialDate = params.date || toLocalIsoDate(new Date());
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [serviceNumber, setServiceNumber] = useState('');
  const [seat, setSeat] = useState('');
  const [transportMode, setTransportMode] = useState<TransportMode>('train');
  const [bookingStatus, setBookingStatus] = useState<BookingStatus>(
    kind === 'activity' ? 'planned' : 'confirmed',
  );
  const [startDate, setStartDate] = useState(initialDate);
  const [startTime, setStartTime] = useState('09:00');
  const [endDate, setEndDate] = useState(kind === 'lodging' ? toLocalIsoDate(addCalendarDays(new Date(`${initialDate}T00:00:00`), 1)) : initialDate);
  const [endTime, setEndTime] = useState(kind === 'lodging' ? '12:00' : '10:00');
  const [activeDateTime, setActiveDateTime] = useState<DateTimeField | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const inferredTitle = useMemo(() => {
    if (kind === 'transport') {
      const route = origin.trim() && destination.trim() ? `${origin.trim()}至${destination.trim()}` : '';
      return [serviceNumber.trim(), route].filter(Boolean).join(' ');
    }
    return title.trim();
  }, [destination, kind, origin, serviceNumber, title]);

  const startAt = toDateTimeIso(startDate, startTime);
  const endAt = toDateTimeIso(endDate, endTime);
  const invalid = !projectId
    || !inferredTitle
    || endAt <= startAt
    || (kind === 'transport' && (!origin.trim() || !destination.trim()))
    || (kind === 'lodging' && !location.trim());

  const createEvent = useCreateEvent({
    mutation: {
      onSuccess: async () => {
        await queryClient.invalidateQueries();
        router.replace({ pathname: '/trips/[id]', params: { id: projectId } });
      },
      onError: (error) => setSubmitError(errorMessage(error, '保存失败，请稍后重试。')),
    },
  });

  const save = () => {
    if (invalid || createEvent.isPending) return;
    const data: CreateEventRequest = {
      title: inferredTitle,
      event_kind: 'schedule',
      all_day: false,
      start_at: startAt,
      end_at: endAt,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      project_id: projectId,
      location: kind === 'transport' ? origin.trim() : location.trim() || null,
      itinerary_details: {
        kind,
        booking_status: bookingStatus,
        attachment_media_ids: [],
        ...(kind === 'transport'
          ? {
              transport_mode: transportMode,
              origin: origin.trim(),
              destination: destination.trim(),
              service_number: serviceNumber.trim() || null,
              seat: seat.trim() || null,
            }
          : {}),
      },
    };
    setSubmitError(null);
    createEvent.mutate({ data });
  };

  const activeDate = activeDateTime === 'end' ? endDate : startDate;
  const activeTime = activeDateTime === 'end' ? endTime : startTime;

  return (
    <AppScreen includeBottomInset>
      <NavHeader title={`新增${kindLabels[kind]}`} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screenBody}>
        <ScrollView
          contentContainerStyle={styles.form}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {kind === 'transport' ? (
            <>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>交通方式</Text>
                <ChoiceChips onChange={setTransportMode} options={transportModes} value={transportMode} />
              </View>
              <View style={styles.pairedFields}>
                <View style={styles.pairedField}>
                  <FormField label="出发地" onChangeText={setOrigin} placeholder="北京南" value={origin} />
                </View>
                <View style={styles.routeDivider}>
                  <View style={styles.routeLine} />
                  <AppIcon color={colors.textTertiary} name="chevron-forward" size={16} />
                </View>
                <View style={styles.pairedField}>
                  <FormField label="到达地" onChangeText={setDestination} placeholder="上海虹桥" value={destination} />
                </View>
              </View>
              <View style={styles.pairedFields}>
                <View style={styles.pairedField}>
                  <FormField label="班次" onChangeText={setServiceNumber} placeholder="G1（可选）" value={serviceNumber} />
                </View>
                <View style={styles.pairedField}>
                  <FormField label="座位" onChangeText={setSeat} placeholder="5车12A（可选）" value={seat} />
                </View>
              </View>
            </>
          ) : (
            <>
              <FormField
                label={kind === 'lodging' ? '住宿名称' : '活动名称'}
                onChangeText={setTitle}
                placeholder={kind === 'lodging' ? '例如：和平饭店' : '例如：参观博物馆'}
                value={title}
              />
              <FormField
                label="地点"
                onChangeText={setLocation}
                placeholder={kind === 'lodging' ? '酒店地址' : '活动地点（可选）'}
                value={location}
              />
            </>
          )}

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{kind === 'lodging' ? '入住时间' : '时间'}</Text>
            <View style={styles.dateTimeRow}>
              <DateTimeButton
                date={startDate}
                label={kind === 'transport' ? '出发' : kind === 'lodging' ? '入住' : '开始'}
                onPress={() => setActiveDateTime('start')}
                time={startTime}
              />
              <View style={styles.dateTimeDivider} />
              <DateTimeButton
                date={endDate}
                label={kind === 'transport' ? '到达' : kind === 'lodging' ? '离店' : '结束'}
                onPress={() => setActiveDateTime('end')}
                time={endTime}
              />
            </View>
            {endAt <= startAt ? <Text style={styles.fieldError}>结束时间必须晚于开始时间</Text> : null}
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>状态</Text>
            <ChoiceChips onChange={setBookingStatus} options={bookingStatuses} value={bookingStatus} />
          </View>
        </ScrollView>

        <View style={styles.footer}>
          {submitError ? <Text accessibilityRole="alert" style={styles.submitError}>{submitError}</Text> : null}
          <AppButton
            disabled={invalid || createEvent.isPending}
            label={createEvent.isPending ? '保存中…' : `保存${kindLabels[kind]}`}
            onPress={save}
          />
        </View>
      </KeyboardAvoidingView>

      <DateTimePickerSheet
        date={activeDate}
        field={activeDateTime}
        onChangeDate={activeDateTime === 'end' ? setEndDate : setStartDate}
        onChangeTime={activeDateTime === 'end' ? setEndTime : setStartTime}
        onClose={() => setActiveDateTime(null)}
        time={activeTime}
      />
    </AppScreen>
  );
}

function toDateTimeIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00`).toISOString();
}

const styles = StyleSheet.create({
  screenBody: { flex: 1 },
  form: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 28,
    gap: 22,
  },
  fieldGroup: { gap: 8 },
  fieldLabel: {
    color: colors.text,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  input: {
    minHeight: 54,
    paddingHorizontal: 14,
    color: colors.text,
    fontFamily,
    ...typography.input,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: 42,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
  },
  chipSelected: { borderColor: colors.primaryTrack, backgroundColor: colors.primarySoft },
  chipText: { color: colors.textSecondary, fontFamily, ...typography.label },
  chipTextSelected: { color: colors.primaryStrong, fontWeight: '600' },
  pairedFields: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  pairedField: { minWidth: 0, flex: 1 },
  routeDivider: { width: 24, height: 54, flexDirection: 'row', alignItems: 'center' },
  routeLine: { width: 8, height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong },
  dateTimeRow: {
    overflow: 'hidden',
    flexDirection: 'row',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  dateTimeButton: { minWidth: 0, minHeight: 92, padding: 13, flex: 1, justifyContent: 'center' },
  dateTimeDivider: { width: StyleSheet.hairlineWidth, marginVertical: 14, backgroundColor: colors.borderStrong },
  dateTimeLabel: { color: colors.textSecondary, fontFamily, ...typography.meta },
  dateTimeValue: { marginTop: 3, color: colors.text, fontFamily, fontSize: 12, lineHeight: 18, fontWeight: '600' },
  dateTimeClock: { marginTop: 2, color: colors.primaryStrong, fontFamily, fontSize: 18, lineHeight: 24, fontWeight: '700', fontVariant: ['tabular-nums'] },
  fieldError: { color: colors.danger, fontFamily, ...typography.meta },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  submitError: { marginBottom: 8, color: colors.danger, fontFamily, ...typography.meta, textAlign: 'center' },
  sheetHeader: { minHeight: 56, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { color: colors.text, fontFamily, ...typography.section },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  wheelArea: { paddingHorizontal: 16, gap: 12 },
  sheetFooter: { padding: 16 },
  pressed: { opacity: 0.62 },
});
