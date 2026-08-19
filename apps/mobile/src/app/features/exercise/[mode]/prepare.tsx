import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

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
  formatWorkoutTargetValue,
  WorkoutTargetSelector,
} from '@/features/workouts/components/workout-target-selector';
import {
  outdoorWorkoutTargets,
  strengthExercises,
  strengthWorkoutGoals,
  workoutAccent,
  workoutModes,
  type WorkoutModeDefinition,
} from '@/features/workouts/mock-data';
import {
  getWorkoutMode,
  isOutdoorWorkoutMode,
  type OutdoorWorkoutMode,
  type OutdoorWorkoutTarget,
} from '@/features/workouts/model';
import { colors, fontFamily, radius } from '@/theme/tokens';

export default function WorkoutPrepareScreen() {
  const params = useLocalSearchParams<{ mode?: string | string[] }>();
  const rawMode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const mode = getWorkoutMode(rawMode);
  const modeDefinition = workoutModes.find((item) => item.id === mode) ?? workoutModes[0];

  if (isOutdoorWorkoutMode(mode)) {
    return <OutdoorWorkoutPrepare mode={mode} modeDefinition={modeDefinition} />;
  }

  return <StrengthWorkoutPrepare modeDefinition={modeDefinition} />;
}

function OutdoorWorkoutPrepare({
  mode,
  modeDefinition,
}: {
  mode: OutdoorWorkoutMode;
  modeDefinition: WorkoutModeDefinition;
}) {
  const router = useRouter();
  const targets = outdoorWorkoutTargets[mode];
  const [selectedTargetId, setSelectedTargetId] = useState(targets[0].id);
  const [targetValue, setTargetValue] = useState(0);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [keepScreenAwake, setKeepScreenAwake] = useState(true);
  const selectedTarget = useMemo(
    () => targets.find((target) => target.id === selectedTargetId) ?? targets[0],
    [selectedTargetId, targets],
  );
  const goalValue = formatWorkoutTargetValue(selectedTarget, targetValue);

  const selectTarget = (target: OutdoorWorkoutTarget) => {
    setSelectedTargetId(target.id);
    setTargetValue(target.id === 'open' ? 0 : target.defaultValue);
  };

  const startWorkout = () => {
    router.push({
      pathname: '/features/exercise/[mode]/active',
      params: {
        mode,
        goal: goalValue,
        voice: voiceEnabled ? '1' : '0',
      },
    } as Href);
  };

  return (
    <AppScreen backgroundColor={workoutAccent.background} includeBottomInset>
      <NavHeader title={modeDefinition.label} />
      <ScrollView
        contentContainerStyle={styles.outdoorContent}
        showsVerticalScrollIndicator={false}
        style={styles.scroll}
      >
        <View style={styles.outdoorIntro}>
          <Text accessibilityRole="header" style={styles.outdoorTitle}>
            设定本次目标
          </Text>
          <Text style={styles.outdoorSubtitle}>达到目标时会提醒你，运动不会自动结束</Text>
        </View>

        <WorkoutTargetSelector
          onSelectTarget={selectTarget}
          onValueChange={setTargetValue}
          selectedTarget={selectedTarget}
          targets={targets}
          value={targetValue}
        />

        <View style={styles.sectionBlock}>
          <WorkoutSectionTitle title="开始前" />
          <View style={styles.readinessBar}>
            <View style={styles.readinessDivider} />
            <ReadinessItem icon="navigate-outline" label="路线已准备" value="等待开始" />
          </View>
        </View>

        <View style={styles.sectionBlock}>
          <WorkoutSectionTitle title="运动设置" />
          <View style={styles.settingsList}>
            <ToggleRow
              icon="volume-medium-outline"
              label="目标与里程语音提醒"
              onValueChange={setVoiceEnabled}
              value={voiceEnabled}
            />
            <ToggleRow
              hideDivider
              icon="phone-portrait-outline"
              label="运动中保持屏幕常亮"
              onValueChange={setKeepScreenAwake}
              value={keepScreenAwake}
            />
          </View>
        </View>

        <View style={styles.noticeWrap}>
          <WorkoutNotice icon="information-circle-outline" tone="neutral">
            这一版不申请定位权限，只记录运动时长；距离结束后可以自己补填。
          </WorkoutNotice>
        </View>
      </ScrollView>

      <View style={styles.bottomBar}>
        <WorkoutPrimaryButton
          icon="play"
          label={`开始${modeDefinition.label}`}
          onPress={startWorkout}
        />
        <Text style={styles.bottomHint}>当前目标：{goalValue}</Text>
      </View>
    </AppScreen>
  );
}

function StrengthWorkoutPrepare({
  modeDefinition,
}: {
  modeDefinition: WorkoutModeDefinition;
}) {
  const router = useRouter();
  const [selectedGoalId, setSelectedGoalId] = useState(strengthWorkoutGoals[0].id);
  const selectedGoal = useMemo(
    () =>
      strengthWorkoutGoals.find((goal) => goal.id === selectedGoalId) ??
      strengthWorkoutGoals[0],
    [selectedGoalId],
  );

  const startWorkout = () => {
    router.push({
      pathname: '/features/exercise/[mode]/active',
      params: {
        mode: 'strength',
        goal: selectedGoal.value,
        voice: '0',
      },
    } as Href);
  };

  return (
    <AppScreen backgroundColor={workoutAccent.background} includeBottomInset>
      <NavHeader title="训练准备" />
      <ScrollView contentContainerStyle={styles.strengthContent} showsVerticalScrollIndicator={false}>
        <View style={styles.modeIntro}>
          <WorkoutIconTile mode="strength" selected size={54} />
          <View style={styles.modeIntroCopy}>
            <Text accessibilityRole="header" style={styles.modeTitle}>
              {modeDefinition.label}
            </Text>
            <Text style={styles.modeCue}>先选一个适合今天状态的训练计划。</Text>
          </View>
        </View>

        <WorkoutSectionTitle title="训练计划" />
        <View accessibilityRole="radiogroup" style={styles.goalGrid}>
          {strengthWorkoutGoals.map((goal) => {
            const selected = goal.id === selectedGoalId;
            return (
              <Pressable
                accessibilityLabel={`${goal.label}，${goal.value}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={goal.id}
                onPress={() => setSelectedGoalId(goal.id)}
                style={({ pressed }) => [
                  styles.goalOption,
                  selected && styles.goalOptionSelected,
                  pressed && styles.goalOptionPressed,
                ]}
              >
                <View style={styles.goalOptionTop}>
                  <Text style={[styles.goalLabel, selected && styles.goalLabelSelected]}>
                    {goal.label}
                  </Text>
                  <View style={[styles.radio, selected && styles.radioSelected]}>
                    {selected ? <View style={styles.radioCenter} /> : null}
                  </View>
                </View>
                <Text style={styles.goalValue}>{goal.value}</Text>
              </Pressable>
            );
          })}
        </View>

        <WorkoutSectionTitle aside="共 6 个动作" title="动作预览" />
        <View style={styles.exercisePreview}>
          {strengthExercises.slice(0, 3).map((exercise, index) => (
            <View key={exercise.id} style={styles.exerciseRow}>
              <View style={styles.exerciseIndex}>
                <Text style={styles.exerciseIndexText}>{index + 1}</Text>
              </View>
              <View style={styles.exerciseCopy}>
                <Text style={styles.exerciseTitle}>{exercise.title}</Text>
                <Text style={styles.exerciseMeta}>
                  {exercise.sets} 组 × {exercise.reps} 次
                </Text>
              </View>
              <AppIcon color={colors.primaryStrong} name={exercise.icon} size={21} />
            </View>
          ))}
          <Text style={styles.moreExercises}>随后还有臀桥、俯身划船和平板支撑</Text>
        </View>
        <WorkoutNotice icon="home-outline" tone="mint">
          这套计划不需要器械，留出一块能伸展手臂的空间即可。
        </WorkoutNotice>

        <View style={styles.footerAction}>
          <WorkoutPrimaryButton
            icon="play"
            label={`开始${selectedGoal.label}`}
            onPress={startWorkout}
          />
          <Text style={styles.footerHint}>训练中可以随时暂停或提前结束</Text>
        </View>
      </ScrollView>
    </AppScreen>
  );
}

function ReadinessItem({
  icon,
  label,
  value,
}: {
  icon: ComponentProps<typeof AppIcon>['name'];
  label: string;
  value: string;
}) {
  return (
    <View style={styles.readinessItem}>
      <View style={styles.readinessIcon}>
        <AppIcon color={colors.primaryStrong} name={icon} size={18} />
      </View>
      <View style={styles.readinessCopy}>
        <Text style={styles.readinessLabel}>{label}</Text>
        <Text style={styles.readinessValue}>{value}</Text>
      </View>
    </View>
  );
}

function ToggleRow({
  icon,
  label,
  value,
  onValueChange,
  hideDivider = false,
}: {
  icon: ComponentProps<typeof AppIcon>['name'];
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  hideDivider?: boolean;
}) {
  return (
    <View style={[styles.settingRow, hideDivider && styles.settingRowLast]}>
      <View style={styles.settingIcon}>
        <AppIcon color={colors.primaryStrong} name={icon} size={19} />
      </View>
      <Text style={styles.settingLabel}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        onValueChange={onValueChange}
        thumbColor={colors.background}
        trackColor={{ false: colors.borderStrong, true: colors.primary }}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  outdoorContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 20,
  },
  outdoorIntro: {
    paddingTop: 12,
    paddingBottom: 20,
  },
  outdoorTitle: {
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '700',
    letterSpacing: -0.35,
  },
  outdoorSubtitle: {
    marginTop: 5,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
  },
  sectionBlock: {
    marginTop: 16,
  },
  readinessBar: {
    minHeight: 66,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  },
  readinessItem: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  readinessIcon: {
    width: 34,
    height: 34,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
  },
  readinessCopy: {
    minWidth: 0,
    flex: 1,
  },
  readinessLabel: {
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  readinessValue: {
    marginTop: 1,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
  },
  readinessDivider: {
    width: StyleSheet.hairlineWidth,
    height: 34,
    marginHorizontal: 12,
    backgroundColor: workoutAccent.hairline,
  },
  settingsList: {
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  },
  settingRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: workoutAccent.hairline,
  },
  settingRowLast: {
    borderBottomWidth: 0,
  },
  settingIcon: {
    width: 34,
    height: 34,
    marginRight: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
  },
  settingLabel: {
    flex: 1,
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '500',
  },
  noticeWrap: {
    marginTop: 14,
  },
  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: workoutAccent.hairline,
    backgroundColor: colors.background,
  },
  bottomHint: {
    marginTop: 6,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  strengthContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 32,
    gap: 10,
  },
  modeIntro: {
    minHeight: 88,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  modeIntroCopy: {
    flex: 1,
  },
  modeTitle: {
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '700',
  },
  modeCue: {
    marginTop: 4,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
  },
  goalGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
  },
  goalOption: {
    width: '48.6%',
    minHeight: 86,
    padding: 13,
    borderWidth: 1,
    borderColor: workoutAccent.hairline,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  goalOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  goalOptionPressed: {
    opacity: 0.65,
  },
  goalOptionTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  goalLabel: {
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  goalLabelSelected: {
    color: colors.primaryStrong,
    fontWeight: '600',
  },
  goalValue: {
    marginTop: 10,
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '700',
  },
  radio: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
  },
  radioSelected: {
    borderColor: colors.primary,
  },
  radioCenter: {
    width: 9,
    height: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  exercisePreview: {
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  },
  exerciseRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: workoutAccent.hairline,
  },
  exerciseIndex: {
    width: 28,
    height: 28,
    marginRight: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  exerciseIndexText: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  exerciseCopy: {
    flex: 1,
  },
  exerciseTitle: {
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  exerciseMeta: {
    marginTop: 2,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 17,
  },
  moreExercises: {
    paddingVertical: 12,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  footerAction: {
    marginTop: 14,
    gap: 8,
  },
  footerHint: {
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
});
