import { errorMessage, useCreateProject } from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
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
import {
  addCalendarDays,
  buildTripRequest,
  formatTripDate,
  toLocalIsoDate,
  validateTripDraft,
  type TripDraft,
} from '@/features/trips/trip-form';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

type DateField = 'startDate' | 'endDate';

function DatePickerSheet({
  field,
  onChange,
  onClose,
  value,
}: {
  field: DateField | null;
  onChange: (value: string) => void;
  onClose: () => void;
  value: string;
}) {
  const currentYear = new Date().getFullYear();

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={field !== null}
    >
      <ModalSheet maxHeight="56%" onClose={onClose}>
        <View style={styles.dateSheetHeader}>
          <Text accessibilityRole="header" style={styles.dateSheetTitle}>
            {field === 'startDate' ? '开始日期' : '结束日期'}
          </Text>
          <Pressable
            accessibilityLabel="关闭日期选择"
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
          >
            <AppIcon color={colors.text} name="close" size={22} />
          </Pressable>
        </View>
        <View style={styles.dateWheelWrap}>
          <DateWheel
            endYear={currentYear + 20}
            onChange={onChange}
            startYear={currentYear - 10}
            value={value}
          />
        </View>
        <View style={styles.dateSheetFooter}>
          <AppButton label="确定" onPress={onClose} />
        </View>
      </ModalSheet>
    </Modal>
  );
}

export default function NewTripScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const initialDates = useMemo(() => {
    const start = addCalendarDays(new Date(), 1);
    return {
      startDate: toLocalIsoDate(start),
      endDate: toLocalIsoDate(addCalendarDays(start, 2)),
    };
  }, []);
  const [draft, setDraft] = useState<TripDraft>({
    title: '',
    destination: '',
    startDate: initialDates.startDate,
    endDate: initialDates.endDate,
    notes: '',
  });
  const [activeDateField, setActiveDateField] = useState<DateField | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const createProject = useCreateProject({
    mutation: {
      onSuccess: (response) => {
        void queryClient.invalidateQueries();
        router.replace({ pathname: '/trips/[id]', params: { id: response.data.id } });
      },
      onError: (error) => {
        setSubmitError(errorMessage(error, '创建失败，请稍后重试。'));
      },
    },
  });

  const validationError = validateTripDraft(draft);
  const updateDraft = <Key extends keyof TripDraft>(key: Key, value: TripDraft[Key]) => {
    setSubmitError(null);
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const save = () => {
    if (validationError || createProject.isPending) return;
    createProject.mutate({ data: buildTripRequest(draft) });
  };

  const activeDateValue = activeDateField ? draft[activeDateField] : draft.startDate;
  const changeActiveDate = (value: string) => {
    if (!activeDateField) return;
    updateDraft(activeDateField, value);
    if (activeDateField === 'startDate' && value > draft.endDate) {
      updateDraft('endDate', value);
    }
  };

  return (
    <AppScreen includeBottomInset>
      <NavHeader
        right={
          <Pressable
            accessibilityLabel="使用 AI 创建行程"
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/capture/new', params: { intent: 'trip' } })}
            style={({ pressed }) => [styles.aiAction, pressed && styles.pressed]}
          >
            <AppIcon color={colors.primaryStrong} name="sparkles-outline" size={16} />
            <Text style={styles.aiActionText}>AI</Text>
          </Pressable>
        }
        title="新建行程"
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.screenBody}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>行程名称</Text>
            <TextInput
              accessibilityLabel="行程名称"
              maxLength={120}
              onChangeText={(value) => updateDraft('title', value)}
              placeholder="例如：北京周末行"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="next"
              selectionColor={colors.primary}
              style={styles.input}
              value={draft.title}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>目的地</Text>
            <TextInput
              accessibilityLabel="目的地"
              maxLength={100}
              onChangeText={(value) => updateDraft('destination', value)}
              placeholder="例如：北京"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="next"
              selectionColor={colors.primary}
              style={styles.input}
              value={draft.destination}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>日期</Text>
            <View style={styles.dateFields}>
              <Pressable
                accessibilityLabel={`开始日期，${formatTripDate(draft.startDate)}`}
                accessibilityRole="button"
                onPress={() => setActiveDateField('startDate')}
                style={({ pressed }) => [styles.dateField, pressed && styles.pressed]}
              >
                <Text style={styles.dateFieldLabel}>开始</Text>
                <Text style={styles.dateFieldValue}>{formatTripDate(draft.startDate)}</Text>
              </Pressable>
              <AppIcon color={colors.textTertiary} name="arrow-forward" size={18} />
              <Pressable
                accessibilityLabel={`结束日期，${formatTripDate(draft.endDate)}`}
                accessibilityRole="button"
                onPress={() => setActiveDateField('endDate')}
                style={({ pressed }) => [styles.dateField, pressed && styles.pressed]}
              >
                <Text style={styles.dateFieldLabel}>结束</Text>
                <Text style={styles.dateFieldValue}>{formatTripDate(draft.endDate)}</Text>
              </Pressable>
            </View>
            {draft.endDate < draft.startDate ? (
              <Text accessibilityRole="alert" style={styles.fieldError}>
                结束日期不能早于开始日期
              </Text>
            ) : null}
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>注意事项</Text>
            <TextInput
              accessibilityLabel="行程注意事项"
              maxLength={500}
              multiline
              onChangeText={(value) => updateDraft('notes', value)}
              placeholder="同行人、证件或特殊安排（可选）"
              placeholderTextColor={colors.textTertiary}
              selectionColor={colors.primary}
              style={[styles.input, styles.notesInput]}
              textAlignVertical="top"
              value={draft.notes}
            />
          </View>
        </ScrollView>

        <View style={styles.footer}>
          {submitError ? (
            <Text accessibilityRole="alert" style={styles.submitError}>{submitError}</Text>
          ) : null}
          <AppButton
            disabled={Boolean(validationError) || createProject.isPending}
            icon="checkmark"
            label={createProject.isPending ? '正在创建…' : '创建行程'}
            onPress={save}
          />
        </View>
      </KeyboardAvoidingView>

      <DatePickerSheet
        field={activeDateField}
        onChange={changeActiveDate}
        onClose={() => setActiveDateField(null)}
        value={activeDateValue}
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  screenBody: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 28,
    gap: 22,
  },
  fieldGroup: {
    gap: 8,
  },
  aiAction: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  aiActionText: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.meta,
    fontWeight: '600',
  },
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
  notesInput: {
    minHeight: 112,
    paddingTop: 14,
    paddingBottom: 14,
  },
  dateFields: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dateField: {
    minWidth: 0,
    minHeight: 66,
    paddingHorizontal: 12,
    flex: 1,
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  dateFieldLabel: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  dateFieldValue: {
    marginTop: 2,
    color: colors.text,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  fieldError: {
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  submitError: {
    marginBottom: 8,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
    textAlign: 'center',
  },
  dateSheetHeader: {
    minHeight: 58,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateSheetTitle: {
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateWheelWrap: {
    paddingHorizontal: 16,
  },
  dateSheetFooter: {
    padding: 16,
  },
  pressed: {
    opacity: 0.62,
  },
});
