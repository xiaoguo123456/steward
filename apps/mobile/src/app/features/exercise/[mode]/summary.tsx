import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import {
  WorkoutMetric,
  WorkoutNotice,
  WorkoutPrimaryButton,
  WorkoutSectionTitle,
} from '@/features/workouts/components/workout-ui';
import { workoutAccent, workoutModes } from '@/features/workouts/workout-content';
import {
  formatWorkoutDuration,
  getWorkoutMode,
  isOutdoorWorkoutMode,
} from '@/features/workouts/model';
import {
  formatAveragePace,
  formatAverageSpeed,
} from '@/features/workouts/workout-location';
import { useBuiltinTracker } from '@/features/trackers/use-builtin-tracker';
import { colors, fontFamily, radius } from '@/theme/tokens';

const feelings = [
  { id: 'easy', label: '轻松', icon: 'leaf-outline' },
  { id: 'good', label: '刚刚好', icon: 'happy-outline' },
  { id: 'tired', label: '有点累', icon: 'water-outline' },
  { id: 'hard', label: '很吃力', icon: 'battery-dead-outline' },
] as const;

export default function WorkoutSummaryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    mode?: string | string[];
    seconds?: string | string[];
    distanceMeters?: string | string[];
  }>();
  const rawMode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const rawSeconds = Array.isArray(params.seconds) ? params.seconds[0] : params.seconds;
  const rawDistanceMeters = Array.isArray(params.distanceMeters)
    ? params.distanceMeters[0]
    : params.distanceMeters;
  const mode = getWorkoutMode(rawMode);
  const outdoor = isOutdoorWorkoutMode(mode);
  const modeDefinition = workoutModes.find((item) => item.id === mode) ?? workoutModes[0];
  const [feeling, setFeeling] = useState<(typeof feelings)[number]['id']>('good');
  const workout = useBuiltinTracker('workout', { limit: 1 });

  const elapsedSeconds = Number(rawSeconds ?? 0) || 0;
  const durationMin = Math.max(1, Math.round(elapsedSeconds / 60));
  const measuredDistanceMeters = positiveNumberOrUndefined(rawDistanceMeters) ?? 0;
  const hasMeasuredDistance = measuredDistanceMeters > 0;
  const [distance, setDistance] = useState(() =>
    hasMeasuredDistance ? (measuredDistanceMeters / 1000).toFixed(2) : '',
  );

  const distanceValue = numberOrUndefined(distance);
  const confirmedDistanceMeters = (distanceValue ?? 0) * 1000;
  const paceOrSpeed =
    mode === 'cycling'
      ? `${formatAverageSpeed(elapsedSeconds, confirmedDistanceMeters)} km/h`
      : formatAveragePace(elapsedSeconds, confirmedDistanceMeters);
  const inputInvalid = distance.trim() !== '' && distanceValue === undefined;

  const saveRecord = () => {
    if (inputInvalid || workout.saving) return;
    // GPS 距离仍允许用户在总结页修正；未测到也未补填的字段不落库。
    workout.save(
      {
        duration_min: durationMin,
        mode,
        distance_km: outdoor ? distanceValue : undefined,
      },
      new Date(),
      // 「感觉」在运动记录项里没有对应字段，但它是用户真给出的信息，
      // 不该收集完就丢掉。放进 note，打卡详情里看得见。
      `感觉：${feelings.find((item) => item.id === feeling)?.label ?? ''}`,
    );
    returnToExerciseHome(true);
  };

  const returnToExerciseHome = (saved = false) => {
    router.dismissTo({
      pathname: '/features/exercise',
      params: saved ? { saved: '1' } : {},
    } as Href);
  };

  return (
    <AppScreen backgroundColor={workoutAccent.background} includeBottomInset>
      <NavHeader onBack={() => returnToExerciseHome(false)} title="运动总结" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.successHeader}>
          <View style={styles.successIcon}>
            <AppIcon color={colors.background} name="checkmark" size={31} />
          </View>
          <Text accessibilityRole="header" style={styles.successTitle}>
            完成得不错
          </Text>
          <Text style={styles.successCopy}>
            {modeDefinition.label}已结束，看看这次留下了什么。
          </Text>
        </View>

        <View style={styles.summaryMetrics}>
          <WorkoutMetric
            emphasized
            label="运动时间"
            value={formatWorkoutDuration(elapsedSeconds)}
          />
          <View style={styles.metricDivider} />
          {outdoor ? (
            <>
              <WorkoutMetric label="距离（公里）" value={distanceValue?.toFixed(2) ?? '--'} />
              <View style={styles.metricDivider} />
              <WorkoutMetric
                label={mode === 'cycling' ? '平均速度' : '平均配速'}
                value={paceOrSpeed}
              />
            </>
          ) : (
            <WorkoutMetric label="运动方式" value={modeDefinition.label} />
          )}
        </View>

        {outdoor ? (
          <>
            <WorkoutSectionTitle title={hasMeasuredDistance ? '确认这次的数据' : '补填这次的数据'} />
            <View style={styles.manualFields}>
              <ManualField
                label="距离"
                onChangeText={setDistance}
                placeholder="例如 5.2"
                unit="公里"
                value={distance}
              />
            </View>
            <Text style={styles.manualHint}>
              {hasMeasuredDistance
                ? '距离来自本次 GPS 轨迹，可以按实际情况修正。'
                : '没有取得有效 GPS 距离；不填就不记这一项。'}
            </Text>
          </>
        ) : null}

        <WorkoutSectionTitle title="这次感觉怎么样？" />
        <View accessibilityRole="radiogroup" style={styles.feelingRow}>
          {feelings.map((item) => {
            const selected = feeling === item.id;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={item.id}
                onPress={() => setFeeling(item.id)}
                style={({ pressed }) => [
                  styles.feelingItem,
                  selected && styles.feelingItemSelected,
                  pressed && styles.feelingItemPressed,
                ]}
              >
                <AppIcon
                  color={selected ? colors.primaryStrong : workoutAccent.muted}
                  name={item.icon}
                  size={22}
                />
                <Text style={[styles.feelingLabel, selected && styles.feelingLabelSelected]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <WorkoutNotice icon="information-circle-outline" tone="neutral">
          {outdoor
            ? '距离由前台 GPS 轨迹计算并经你确认后保存；原始定位点不会上传。'
            : '本次训练时长会在你确认后保存到「打卡」。'}
        </WorkoutNotice>

        <View style={styles.footerActions}>
          {inputInvalid ? (
            <Text style={styles.inputError}>距离请填数字。</Text>
          ) : null}
          <WorkoutPrimaryButton
            icon="checkmark-circle-outline"
            label={workout.saving ? '正在保存…' : '保存运动记录'}
            onPress={saveRecord}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => returnToExerciseHome(false)}
            style={({ pressed }) => [styles.skipSave, pressed && styles.skipSavePressed]}
          >
            <Text style={styles.skipSaveText}>不保存，返回运动首页</Text>
          </Pressable>
        </View>
      </ScrollView>
    </AppScreen>
  );
}

/** 手填的一项。留空就是「这次不记这一项」，不是 0。 */
function ManualField({
  label,
  unit,
  value,
  placeholder,
  onChangeText,
}: {
  label: string;
  unit: string;
  value: string;
  placeholder: string;
  onChangeText: (value: string) => void;
}) {
  return (
    <View style={styles.manualField}>
      <Text style={styles.manualLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={`${label}（${unit}）`}
        keyboardType="decimal-pad"
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={workoutAccent.muted}
        style={styles.manualInput}
        value={value}
      />
      <Text style={styles.manualUnit}>{unit}</Text>
    </View>
  );
}

/** 空串表示没填，非法输入返回 undefined 交给调用方拦下。 */
function numberOrUndefined(raw: string): number | undefined {
  const text = raw.trim();
  if (text === '') return undefined;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function positiveNumberOrUndefined(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

const styles = StyleSheet.create({
  manualFields: {
    gap: 10,
  },
  manualField: {
    minHeight: 52,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  manualLabel: {
    width: 44,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
  },
  manualInput: {
    flex: 1,
    minHeight: 48,
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 16,
    lineHeight: 24,
  },
  manualUnit: {
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
  },
  manualHint: {
    marginTop: 10,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
  },
  inputError: {
    marginBottom: 10,
    color: colors.danger,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 32,
    gap: 12,
  },
  successHeader: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 10,
  },
  successIcon: {
    width: 60,
    height: 60,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  successTitle: {
    marginTop: 14,
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 25,
    lineHeight: 33,
    fontWeight: '700',
  },
  successCopy: {
    marginTop: 5,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  summaryMetrics: {
    minHeight: 92,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  },
  metricDivider: {
    width: StyleSheet.hairlineWidth,
    height: 42,
    backgroundColor: workoutAccent.hairline,
  },
  detailSection: {
    marginTop: 2,
  },
  detailRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  detailLabel: {
    width: 38,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    fontVariant: ['tabular-nums'],
  },
  splitTrack: {
    flex: 1,
    height: 7,
    overflow: 'hidden',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  splitFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  detailValue: {
    width: 54,
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  readableStats: {
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  },
  readableStatRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: workoutAccent.hairline,
  },
  readableStatLabel: {
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
  },
  readableStatValue: {
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  strengthSummaryList: {
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  },
  strengthSummaryRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: workoutAccent.hairline,
  },
  summaryIndex: {
    width: 28,
    height: 28,
    marginRight: 10,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  summaryIndexText: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
  },
  summaryExerciseCopy: {
    flex: 1,
  },
  summaryExerciseTitle: {
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  summaryExerciseMeta: {
    marginTop: 2,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 17,
  },
  moreCompleted: {
    paddingVertical: 11,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  feelingRow: {
    flexDirection: 'row',
    gap: 8,
  },
  feelingItem: {
    flex: 1,
    minHeight: 74,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: workoutAccent.hairline,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  feelingItemSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  feelingItemPressed: {
    opacity: 0.62,
  },
  feelingLabel: {
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
  },
  feelingLabelSelected: {
    color: colors.primaryStrong,
    fontWeight: '600',
  },
  footerActions: {
    marginTop: 8,
  },
  skipSave: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipSavePressed: {
    opacity: 0.55,
  },
  skipSaveText: {
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
  },
});
