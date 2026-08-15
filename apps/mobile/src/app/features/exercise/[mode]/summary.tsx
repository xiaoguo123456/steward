import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { RouteMap } from '@/features/workouts/components/route-map';
import {
  WorkoutMetric,
  WorkoutNotice,
  WorkoutPrimaryButton,
  WorkoutSectionTitle,
} from '@/features/workouts/components/workout-ui';
import {
  strengthExercises,
  workoutAccent,
  workoutModes,
} from '@/features/workouts/mock-data';
import { getWorkoutMode, isOutdoorWorkoutMode } from '@/features/workouts/model';
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
    duration?: string | string[];
  }>();
  const rawMode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const duration = Array.isArray(params.duration) ? params.duration[0] : params.duration;
  const mode = getWorkoutMode(rawMode);
  const outdoor = isOutdoorWorkoutMode(mode);
  const modeDefinition = workoutModes.find((item) => item.id === mode) ?? workoutModes[0];
  const [feeling, setFeeling] = useState<(typeof feelings)[number]['id']>('good');
  const summary = workoutSummary[mode];

  const returnHome = (saved = false) => {
    router.replace({
      pathname: '/features/exercise',
      params: saved ? { saved: '1' } : {},
    } as Href);
  };

  return (
    <AppScreen backgroundColor={workoutAccent.background} includeBottomInset>
      <NavHeader onBack={() => returnHome(false)} title="运动总结" />
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

        {outdoor ? <RouteMap compact mode={mode} showCurrent={false} /> : null}

        <View style={styles.summaryMetrics}>
          <WorkoutMetric emphasized label={summary.primaryLabel} value={summary.primaryValue} />
          <View style={styles.metricDivider} />
          <WorkoutMetric label="运动时间" value={duration ?? summary.duration} />
          <View style={styles.metricDivider} />
          <WorkoutMetric label={summary.thirdLabel} value={summary.thirdValue} />
        </View>

        {outdoor ? (
          <OutdoorDetail mode={mode} />
        ) : (
          <StrengthDetail />
        )}

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
          当前只保存本地预览状态。正式版本会在你确认后写入对应运动 Record。
        </WorkoutNotice>

        <View style={styles.footerActions}>
          <WorkoutPrimaryButton
            icon="checkmark-circle-outline"
            label="保存运动记录"
            onPress={() => returnHome(true)}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => returnHome(false)}
            style={({ pressed }) => [styles.skipSave, pressed && styles.skipSavePressed]}
          >
            <Text style={styles.skipSaveText}>不保存，返回运动首页</Text>
          </Pressable>
        </View>
      </ScrollView>
    </AppScreen>
  );
}

function OutdoorDetail({ mode }: { mode: 'running' | 'walking' | 'cycling' }) {
  if (mode === 'running') {
    return (
      <View style={styles.detailSection}>
        <WorkoutSectionTitle aside="每公里" title="配速分段" />
        {[
          ['1 km', `06'18\"`],
          ['2 km', `06'08\"`],
          ['3 km', `06'15\"`],
          ['4 km', `06'02\"`],
          ['5 km', `06'07\"`],
        ].map(([label, value], index) => (
          <View key={label} style={styles.detailRow}>
            <Text style={styles.detailLabel}>{label}</Text>
            <View style={styles.splitTrack}>
              <View style={[styles.splitFill, { width: `${78 + index * 4}%` }]} />
            </View>
            <Text style={styles.detailValue}>{value}</Text>
          </View>
        ))}
      </View>
    );
  }

  if (mode === 'walking') {
    return (
      <View style={styles.detailSection}>
        <WorkoutSectionTitle title="健走表现" />
        <View style={styles.readableStats}>
          <ReadableStat label="总步数" value="6218 步" />
          <ReadableStat label="平均步频" value="128 步/分钟" />
          <ReadableStat label="本周完成" value="2 / 3 次" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.detailSection}>
      <WorkoutSectionTitle title="骑行表现" />
      <View style={styles.readableStats}>
        <ReadableStat label="平均速度" value="18.4 km/h" />
        <ReadableStat label="最快速度" value="24.2 km/h" />
        <ReadableStat label="累计爬升" value="86 米" />
      </View>
    </View>
  );
}

function StrengthDetail() {
  return (
    <View style={styles.detailSection}>
      <WorkoutSectionTitle aside="17 组" title="完成动作" />
      <View style={styles.strengthSummaryList}>
        {strengthExercises.slice(0, 4).map((exercise, index) => (
          <View key={exercise.id} style={styles.strengthSummaryRow}>
            <View style={styles.summaryIndex}>
              <Text style={styles.summaryIndexText}>{index + 1}</Text>
            </View>
            <View style={styles.summaryExerciseCopy}>
              <Text style={styles.summaryExerciseTitle}>{exercise.title}</Text>
              <Text style={styles.summaryExerciseMeta}>
                {exercise.sets} 组 × {exercise.reps} 次
              </Text>
            </View>
            <AppIcon color={colors.primary} name="checkmark-circle" size={20} />
          </View>
        ))}
        <Text style={styles.moreCompleted}>另完成俯身划船和平板支撑</Text>
      </View>
    </View>
  );
}

function ReadableStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.readableStatRow}>
      <Text style={styles.readableStatLabel}>{label}</Text>
      <Text style={styles.readableStatValue}>{value}</Text>
    </View>
  );
}

const workoutSummary = {
  running: {
    primaryLabel: '运动距离',
    primaryValue: '5.24 km',
    duration: '32:18',
    thirdLabel: '平均配速',
    thirdValue: `06'10\"`,
  },
  walking: {
    primaryLabel: '运动距离',
    primaryValue: '4.12 km',
    duration: '48:16',
    thirdLabel: '总步数',
    thirdValue: '6218',
  },
  cycling: {
    primaryLabel: '运动距离',
    primaryValue: '12.80 km',
    duration: '41:44',
    thirdLabel: '平均速度',
    thirdValue: '18.4',
  },
  strength: {
    primaryLabel: '完成动作',
    primaryValue: '6 个',
    duration: '27:08',
    thirdLabel: '完成组数',
    thirdValue: '17 组',
  },
} as const;

const styles = StyleSheet.create({
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
