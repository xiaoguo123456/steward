import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AiFab } from '@/components/ui/ai-fab';
import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import {
  WorkoutIconTile,
  WorkoutNotice,
  WorkoutPrimaryButton,
  WorkoutSectionTitle,
} from '@/features/workouts/components/workout-ui';
import {
  recentWorkouts,
  weeklyWorkoutDays,
  workoutAccent,
  workoutModes,
} from '@/features/workouts/mock-data';
import type { WorkoutMode } from '@/features/workouts/model';
import { colors, fontFamily, radius } from '@/theme/tokens';

function getPrepareRoute(mode: WorkoutMode) {
  return {
    pathname: '/features/exercise/[mode]/prepare',
    params: { mode },
  } as Href;
}

export default function ExerciseHomeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ saved?: string }>();
  const [selectedMode, setSelectedMode] = useState<WorkoutMode>('running');
  const selectedDefinition = useMemo(
    () => workoutModes.find((mode) => mode.id === selectedMode) ?? workoutModes[0],
    [selectedMode],
  );
  const latestWorkout = recentWorkouts[0];

  return (
    <AppScreen backgroundColor={workoutAccent.background} includeBottomInset>
      <NavHeader
        right={
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.push('/features/exercise/history' as Href)}
            style={({ pressed }) => pressed && styles.textButtonPressed}
          >
            <Text style={styles.headerAction}>记录</Text>
          </Pressable>
        }
        title="运动"
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {params.saved === '1' ? (
          <WorkoutNotice icon="checkmark-circle" tone="mint">
            运动记录已保存到本地预览，正式接入后会同步到“打卡”。
          </WorkoutNotice>
        ) : null}

        <View style={styles.heroCopy}>
          <Text accessibilityRole="header" style={styles.heroTitle}>
            今天想怎么动？
          </Text>
          <Text style={styles.heroSubtitle}>轻松开始，持续更重要</Text>
        </View>

        <View accessibilityRole="radiogroup" style={styles.modeGrid}>
          {workoutModes.map((mode) => {
            const selected = mode.id === selectedMode;
            return (
              <Pressable
                accessibilityLabel={`${mode.label}，${mode.cue}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={mode.id}
                onPress={() => setSelectedMode(mode.id)}
                style={({ pressed }) => [
                  styles.modeCard,
                  selected && styles.modeCardSelected,
                  pressed && styles.modeCardPressed,
                ]}
              >
                <View style={styles.modeCardTop}>
                  <WorkoutIconTile icon={mode.icon} selected={selected} />
                  {selected ? (
                    <View style={styles.selectedMark}>
                      <AppIcon color={colors.background} name="checkmark" size={14} />
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.modeLabel, selected && styles.modeLabelSelected]}>
                  {mode.label}
                </Text>
                <Text numberOfLines={1} style={styles.modeCue}>
                  {mode.cue}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.startSection}>
          <View style={styles.selectedSummary}>
            <View style={styles.selectedSummaryCopy}>
              <Text style={styles.selectedSummaryLabel}>{selectedDefinition.label}</Text>
              <Text style={styles.selectedSummaryMeta}>
                {selectedMode === 'strength' ? '全身入门 · 约 25 分钟' : '目标可在开始前设置'}
              </Text>
            </View>
            <View style={styles.goalValue}>
              <Text style={styles.goalValueText}>
                {selectedMode === 'strength' ? '6 个动作' : '不限目标'}
              </Text>
              <AppIcon color={workoutAccent.muted} name="chevron-forward" size={16} />
            </View>
          </View>
          <WorkoutPrimaryButton
            icon="play"
            label={`开始${selectedDefinition.label}`}
            onPress={() => router.push(getPrepareRoute(selectedMode))}
          />
        </View>

        <WorkoutSectionTitle aside="还差 1 次" title="本周 2 / 3 次" />
        <View style={styles.weekStrip}>
          {weeklyWorkoutDays.map((day) => (
            <View key={day.label} style={styles.dayItem}>
              <Text style={styles.dayLabel}>{day.label}</Text>
              <View
                style={[
                  styles.dayDot,
                  day.state === 'done' && styles.dayDotDone,
                  day.state === 'planned' && styles.dayDotPlanned,
                  day.state === 'current' && styles.dayDotCurrent,
                ]}
              >
                {day.state === 'done' ? (
                  <AppIcon color={colors.background} name="checkmark" size={14} />
                ) : day.state === 'current' ? (
                  <View style={styles.currentDayCenter} />
                ) : null}
              </View>
            </View>
          ))}
        </View>

        <WorkoutSectionTitle
          aside="查看全部"
          onAsidePress={() => router.push('/features/exercise/history' as Href)}
          title="最近运动"
        />
        <Pressable
          accessibilityLabel={`${latestWorkout.title}，${latestWorkout.date}，${latestWorkout.primary}`}
          accessibilityRole="button"
          onPress={() => router.push('/features/exercise/history' as Href)}
          style={({ pressed }) => [styles.recentRow, pressed && styles.recentRowPressed]}
        >
          <WorkoutIconTile icon="walk" size={44} />
          <View style={styles.recentCopy}>
            <Text style={styles.recentTitle}>
              {latestWorkout.title} <Text style={styles.recentDate}>· {latestWorkout.date}</Text>
            </Text>
            <Text style={styles.recentMeta}>
              {latestWorkout.primary} · {latestWorkout.duration}
            </Text>
          </View>
          <AppIcon color={colors.borderStrong} name="chevron-forward" size={19} />
        </Pressable>
      </ScrollView>
      <AiFab />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 96,
    gap: 8,
  },
  headerAction: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  textButtonPressed: {
    opacity: 0.55,
  },
  heroCopy: {
    paddingTop: 12,
    paddingBottom: 16,
  },
  heroTitle: {
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 26,
    lineHeight: 34,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  heroSubtitle: {
    marginTop: 7,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
  },
  modeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
  },
  modeCard: {
    width: '48.4%',
    minHeight: 138,
    padding: 14,
    borderWidth: 1,
    borderColor: workoutAccent.hairline,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  },
  modeCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  modeCardPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.99 }],
  },
  modeCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  selectedMark: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  modeLabel: {
    marginTop: 13,
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '700',
  },
  modeLabelSelected: {
    color: colors.primaryStrong,
  },
  modeCue: {
    marginTop: 4,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  startSection: {
    marginTop: 16,
    paddingTop: 17,
    gap: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: workoutAccent.hairline,
  },
  selectedSummary: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectedSummaryCopy: {
    flex: 1,
    minWidth: 0,
  },
  selectedSummaryLabel: {
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '700',
  },
  selectedSummaryMeta: {
    marginTop: 3,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  goalValue: {
    minHeight: 44,
    marginLeft: 12,
    paddingLeft: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  goalValueText: {
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '500',
  },
  weekStrip: {
    minHeight: 80,
    paddingHorizontal: 6,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  },
  dayItem: {
    alignItems: 'center',
    gap: 8,
  },
  dayLabel: {
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 17,
  },
  dayDot: {
    width: 29,
    height: 29,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  dayDotDone: {
    backgroundColor: colors.primary,
  },
  dayDotPlanned: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.background,
  },
  dayDotCurrent: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  currentDayCenter: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryStrong,
  },
  recentRow: {
    minHeight: 72,
    marginBottom: 56,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  },
  recentRowPressed: {
    opacity: 0.62,
  },
  recentCopy: {
    flex: 1,
    minWidth: 0,
  },
  recentTitle: {
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  recentDate: {
    color: workoutAccent.muted,
    fontWeight: '400',
  },
  recentMeta: {
    marginTop: 4,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontVariant: ['tabular-nums'],
  },
});
