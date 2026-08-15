import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
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
  strengthExercises,
  workoutAccent,
  workoutGoals,
  workoutModes,
} from '@/features/workouts/mock-data';
import { getWorkoutMode, isOutdoorWorkoutMode } from '@/features/workouts/model';
import { colors, fontFamily, radius } from '@/theme/tokens';

export default function WorkoutPrepareScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string | string[] }>();
  const rawMode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const mode = getWorkoutMode(rawMode);
  const modeDefinition = workoutModes.find((item) => item.id === mode) ?? workoutModes[0];
  const goalOptions = workoutGoals[mode];
  const [selectedGoalId, setSelectedGoalId] = useState(goalOptions[0].id);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [keepScreenAwake, setKeepScreenAwake] = useState(true);
  const selectedGoal = useMemo(
    () => goalOptions.find((goal) => goal.id === selectedGoalId) ?? goalOptions[0],
    [goalOptions, selectedGoalId],
  );
  const outdoor = isOutdoorWorkoutMode(mode);

  const startWorkout = () => {
    router.push({
      pathname: '/features/exercise/[mode]/active',
      params: {
        mode,
        goal: selectedGoal.value,
        voice: voiceEnabled ? '1' : '0',
      },
    } as Href);
  };

  return (
    <AppScreen backgroundColor={workoutAccent.background} includeBottomInset>
      <NavHeader title={outdoor ? '运动准备' : '训练准备'} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.modeIntro}>
          <WorkoutIconTile icon={modeDefinition.icon} selected size={54} />
          <View style={styles.modeIntroCopy}>
            <Text accessibilityRole="header" style={styles.modeTitle}>
              {modeDefinition.label}
            </Text>
            <Text style={styles.modeCue}>
              {outdoor ? '确认目标与设备状态，准备好就出发。' : '先选一个适合今天状态的训练计划。'}
            </Text>
          </View>
        </View>

        <WorkoutSectionTitle title={outdoor ? '本次目标' : '训练计划'} />
        <View accessibilityRole="radiogroup" style={styles.goalGrid}>
          {goalOptions.map((goal) => {
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

        {outdoor ? (
          <>
            <WorkoutSectionTitle title="开始前检查" />
            <View style={styles.checkList}>
              <StatusRow icon="location-outline" label="定位" value="模拟信号良好" />
              <StatusRow icon="navigate-outline" label="路线记录" value="已准备" />
              <ToggleRow
                icon="volume-medium-outline"
                label="每公里语音播报"
                onValueChange={setVoiceEnabled}
                value={voiceEnabled}
              />
              <ToggleRow
                icon="phone-portrait-outline"
                label="运动中保持屏幕常亮"
                onValueChange={setKeepScreenAwake}
                value={keepScreenAwake}
              />
            </View>
            <WorkoutNotice icon="information-circle-outline" tone="neutral">
              当前为前端模拟，不会申请定位权限，也不会在后台记录真实轨迹。
            </WorkoutNotice>
          </>
        ) : (
          <>
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
          </>
        )}

        <View style={styles.footerAction}>
          <WorkoutPrimaryButton
            icon="play"
            label={outdoor ? '开始并查看模拟路线' : `开始${selectedGoal.label}`}
            onPress={startWorkout}
          />
          <Text style={styles.footerHint}>
            {outdoor ? `当前目标：${selectedGoal.value}` : '训练中可以随时暂停或提前结束'}
          </Text>
        </View>
      </ScrollView>
    </AppScreen>
  );
}

function StatusRow({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<typeof AppIcon>['name'];
  label: string;
  value: string;
}) {
  return (
    <View style={styles.statusRow}>
      <View style={styles.statusIcon}>
        <AppIcon color={colors.primaryStrong} name={icon} size={19} />
      </View>
      <Text style={styles.statusLabel}>{label}</Text>
      <View style={styles.statusValueWrap}>
        <View style={styles.statusDot} />
        <Text style={styles.statusValue}>{value}</Text>
      </View>
    </View>
  );
}

function ToggleRow({
  icon,
  label,
  value,
  onValueChange,
}: {
  icon: React.ComponentProps<typeof AppIcon>['name'];
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.statusRow}>
      <View style={styles.statusIcon}>
        <AppIcon color={colors.primaryStrong} name={icon} size={19} />
      </View>
      <Text style={styles.statusLabel}>{label}</Text>
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
  content: {
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
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
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
  checkList: {
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  },
  statusRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: workoutAccent.hairline,
  },
  statusIcon: {
    width: 34,
    height: 34,
    marginRight: 11,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  statusLabel: {
    flex: 1,
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '500',
  },
  statusValueWrap: {
    marginLeft: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  statusValue: {
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
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
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
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
