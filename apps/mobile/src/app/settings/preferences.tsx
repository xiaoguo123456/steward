import { errorMessage, type UserPreferences } from '@steward/api-client';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppScreen } from '@/components/ui/app-screen';
import { NavHeader } from '@/components/ui/nav-header';
import { SectionTitle } from '@/components/ui/section-title';
import { StatePanel } from '@/components/ui/state-panel';
import { useAccountActions, useUserPreferences } from '@/features/account/use-account';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

/**
 * 时间与作息偏好。
 *
 * 这四项都是服务端真会用到的：周视图从哪天起、工作时间用于安排建议与
 * 日历高亮、默认提醒时间用于全天日程和只有日期的截止。
 *
 * 原来这一页还有「周末工作」「默认任务耗时」这类开关，契约里没有对应字段，
 * 拨动它们什么也不会发生。删掉了——用户以为设置生效了才是真的坑。
 */
export default function PreferencesScreen() {
  const router = useRouter();
  const { preferences, loading, failed, error, refetch } = useUserPreferences();
  const actions = useAccountActions();

  const [draft, setDraft] = useState<Partial<UserPreferences> | null>(null);

  if (loading) {
    return (
      <AppScreen includeBottomInset>
        <NavHeader onBack={() => router.back()} title="时间与作息" />
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </AppScreen>
    );
  }

  if (failed || !preferences) {
    return (
      <AppScreen includeBottomInset>
        <NavHeader onBack={() => router.back()} title="时间与作息" />
        <View style={styles.content}>
          <StatePanel
            actionLabel="重试"
            icon="cloud-offline-outline"
            message={errorMessage(error, '暂时无法加载偏好设置。')}
            onAction={refetch}
            title="加载失败"
          />
        </View>
      </AppScreen>
    );
  }

  // 未编辑的字段跟随服务端值，不在 effect 里往 state 里抄一份。
  const current = { ...preferences, ...draft };
  const patch = (next: Partial<UserPreferences>) =>
    setDraft((existing) => ({ ...existing, ...next }));

  const invalid = [
    current.work_day_start,
    current.work_day_end,
    current.default_reminder_local_time,
  ].some((value) => !isClock(value));

  const dirty =
    current.week_start !== preferences.week_start ||
    current.work_day_start !== preferences.work_day_start ||
    current.work_day_end !== preferences.work_day_end ||
    current.default_reminder_local_time !== preferences.default_reminder_local_time;

  const save = async () => {
    if (invalid || !dirty) return;
    const done = await actions.updatePreferences({
      week_start: current.week_start,
      work_day_start: current.work_day_start,
      work_day_end: current.work_day_end,
      default_reminder_local_time: current.default_reminder_local_time,
    });
    if (done) {
      setDraft(null);
      refetch();
    }
  };

  return (
    <AppScreen includeBottomInset>
      <NavHeader onBack={() => router.back()} title="时间与作息" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <SectionTitle title="每周从哪天开始" />
        <View style={styles.segmented}>
          {(['monday', 'sunday'] as const).map((day) => (
            <Pressable
              accessibilityLabel={day === 'monday' ? '每周从周一开始' : '每周从周日开始'}
              accessibilityRole="radio"
              accessibilityState={{ checked: current.week_start === day }}
              key={day}
              onPress={() => patch({ week_start: day })}
              style={({ pressed }) => [
                styles.segment,
                current.week_start === day && styles.segmentActive,
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[
                  styles.segmentText,
                  current.week_start === day && styles.segmentTextActive,
                ]}
              >
                {day === 'monday' ? '周一' : '周日'}
              </Text>
            </Pressable>
          ))}
        </View>

        <SectionTitle style={styles.section} title="工作时间" />
        <View style={styles.clockRow}>
          <ClockField
            label="开始"
            onChange={(work_day_start) => patch({ work_day_start })}
            value={current.work_day_start}
          />
          <Text style={styles.clockDash}>—</Text>
          <ClockField
            label="结束"
            onChange={(work_day_end) => patch({ work_day_end })}
            value={current.work_day_end}
          />
        </View>
        <Text style={styles.hint}>安排建议与日历高亮都按这段时间来。</Text>

        <SectionTitle style={styles.section} title="默认提醒时间" />
        <ClockField
          label="当地时间"
          onChange={(default_reminder_local_time) => patch({ default_reminder_local_time })}
          value={current.default_reminder_local_time}
        />
        <Text style={styles.hint}>
          全天日程和只写了日期的截止，会在这个时间提醒你。
        </Text>

        {invalid ? <Text style={styles.failure}>时间格式应为 09:00。</Text> : null}
        {actions.failure ? <Text style={styles.failure}>{actions.failure}</Text> : null}

        <AppButton
          disabled={actions.busy || !dirty || invalid}
          label={actions.busy ? '正在保存…' : '保存'}
          onPress={() => void save()}
          style={styles.submit}
        />
      </ScrollView>
    </AppScreen>
  );
}

function ClockField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.clockField}>
      <Text style={styles.clockLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        keyboardType="numbers-and-punctuation"
        maxLength={5}
        onChangeText={onChange}
        placeholder="09:00"
        placeholderTextColor={colors.textTertiary}
        style={styles.clockInput}
        value={value}
      />
    </View>
  );
}

/** HH:MM，且小时与分钟都在有效范围内。 */
function isClock(value: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  return Number(match[1]) <= 23 && Number(match[2]) <= 59;
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  loading: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  section: {
    marginTop: 22,
  },
  segmented: {
    flexDirection: 'row',
    gap: 8,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  segmentActive: {
    backgroundColor: colors.primarySoft,
  },
  segmentText: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
  },
  segmentTextActive: {
    color: colors.primaryStrong,
    fontWeight: '600',
  },
  clockRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  clockField: {
    flex: 1,
    gap: 6,
  },
  clockLabel: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  clockInput: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily,
    ...typography.input,
  },
  clockDash: {
    paddingBottom: 14,
    color: colors.textTertiary,
    fontFamily,
    ...typography.body,
  },
  hint: {
    marginTop: 10,
    color: colors.textTertiary,
    fontFamily,
    ...typography.meta,
  },
  submit: {
    marginTop: 28,
  },
  failure: {
    marginTop: 14,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  pressed: {
    opacity: 0.6,
  },
});
