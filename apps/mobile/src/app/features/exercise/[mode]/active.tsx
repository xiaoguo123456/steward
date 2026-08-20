import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { RouteMap } from '@/features/workouts/components/route-map';
import {
  WorkoutDivider,
  WorkoutPrimaryButton,
} from '@/features/workouts/components/workout-ui';
import {
  workoutAccent,
  workoutModes,
} from '@/features/workouts/workout-content';
import {
  describeMeasure,
  describeVolume,
  getPlan,
  planExercises,
  type StrengthExercise,
} from '@/features/workouts/strength-library';
import {
  formatWorkoutDuration,
  getWorkoutMode,
  isOutdoorWorkoutMode,
  type OutdoorWorkoutMode,
} from '@/features/workouts/model';
import { useClientReady } from '@/hooks/use-client-ready';
import { colors, fontFamily, radius } from '@/theme/tokens';

type ActiveStatus = 'active' | 'paused';

export default function ActiveWorkoutScreen() {
  const params = useLocalSearchParams<{
    mode?: string | string[];
    goal?: string | string[];
    plan?: string | string[];
    voice?: string | string[];
  }>();
  const rawMode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const mode = getWorkoutMode(rawMode);

  if (isOutdoorWorkoutMode(mode)) {
    return <OutdoorActiveWorkout mode={mode} params={params} />;
  }

  const planId = Array.isArray(params.plan) ? params.plan[0] : params.plan;
  return <StrengthActiveWorkout planId={planId} />;
}

function OutdoorActiveWorkout({
  mode,
  params,
}: {
  mode: OutdoorWorkoutMode;
  params: {
    goal?: string | string[];
    voice?: string | string[];
  };
}) {
  const router = useRouter();
  const clientReady = useClientReady();
  const [status, setStatus] = useState<ActiveStatus>('active');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const goalParam = Array.isArray(params.goal) ? params.goal[0] : params.goal;
  const voiceParam = Array.isArray(params.voice) ? params.voice[0] : params.voice;
  const goal = clientReady ? goalParam : undefined;
  const voice = clientReady ? voiceParam : undefined;
  const modeDefinition = workoutModes.find((item) => item.id === mode) ?? workoutModes[0];

  useEffect(() => {
    if (status !== 'active' || showEndConfirm) return;
    const timer = setInterval(() => setElapsedSeconds((current) => current + 1), 1000);
    return () => clearInterval(timer);
  }, [showEndConfirm, status]);

  const finishWorkout = () => {
    router.replace({
      pathname: '/features/exercise/[mode]/summary',
      params: { mode, seconds: String(elapsedSeconds) },
    } as Href);
  };

  return (
    <AppScreen backgroundColor={workoutAccent.background} includeBottomInset>
      <NavHeader
        onBack={() => setShowEndConfirm(true)}
        right={
          <View style={styles.lockButton}>
            <AppIcon color={workoutAccent.ink} name="lock-closed-outline" size={19} />
          </View>
        }
        title={modeDefinition.label}
      />

      <View style={styles.outdoorBody}>
        <View style={styles.mapWrap}>
          <RouteMap />
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveBadgeText}>{status === 'active' ? '记录中' : '已暂停'}</Text>
          </View>
          {goal ? (
            <View style={styles.goalBadge}>
              <Text style={styles.goalBadgeText}>目标 · {goal}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.outdoorTray}>
          {/*
            主数字是用时，不是距离。
            这一版不申请定位与计步权限，能诚实测到的只有经过的时间；
            把一个不会变的「5.24 公里」摆在最显眼处，比不显示更糟。
          */}
          <View style={styles.distanceLine}>
            <Text style={styles.distanceValue}>{formatWorkoutDuration(elapsedSeconds)}</Text>
          </View>

          <Text style={styles.currentMetric}>
            {modeDefinition.label}进行中 · 距离与配速这一版不记录，结束后可以自己补填
          </Text>

          <View style={styles.outdoorControls}>
            <Pressable
              accessibilityLabel={status === 'active' ? '暂停运动' : '继续运动'}
              accessibilityRole="button"
              onPress={() => setStatus((current) => (current === 'active' ? 'paused' : 'active'))}
              style={({ pressed }) => [styles.pauseButton, pressed && styles.controlPressed]}
            >
              <AppIcon
                color={colors.background}
                name={status === 'active' ? 'pause' : 'play'}
                size={36}
              />
              <Text style={styles.pauseButtonText}>{status === 'active' ? '暂停' : '继续'}</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="结束运动"
              accessibilityRole="button"
              onPress={() => setShowEndConfirm(true)}
              style={({ pressed }) => [styles.stopButton, pressed && styles.controlPressed]}
            >
              <View style={styles.stopSquare} />
              <Text style={styles.stopLabel}>结束</Text>
            </Pressable>
          </View>

          <View style={styles.announcement}>
            <AppIcon color={colors.primaryStrong} name="volume-medium-outline" size={18} />
            <Text style={styles.announcementText}>
              {voice === '0' ? '语音播报 · 已关闭' : '每公里播报 · 已开启'}
            </Text>
          </View>
        </View>
      </View>

      {showEndConfirm ? (
        <EndWorkoutSheet
          onContinue={() => setShowEndConfirm(false)}
          onFinish={finishWorkout}
          title={`结束${modeDefinition.label}？`}
        />
      ) : null}
    </AppScreen>
  );
}

function StrengthActiveWorkout({ planId }: { planId?: string }) {
  const router = useRouter();
  const plan = getPlan(planId);
  const strengthExercises = planExercises(plan);
  const [status, setStatus] = useState<ActiveStatus>('active');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [completedSets, setCompletedSets] = useState(0);
  const [restSeconds, setRestSeconds] = useState(0);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const currentExercise = strengthExercises[exerciseIndex];
  const nextExercise = strengthExercises[exerciseIndex + 1];
  const completedTotal = exerciseIndex * 3 + completedSets;
  const totalSets = strengthExercises.reduce(
    (sum: number, item: StrengthExercise) => sum + item.sets,
    0,
  );
  const progress = Math.min(1, completedTotal / totalSets);

  useEffect(() => {
    if (status !== 'active' || showEndConfirm) return;
    const timer = setInterval(() => setElapsedSeconds((current) => current + 1), 1000);
    return () => clearInterval(timer);
  }, [showEndConfirm, status]);

  useEffect(() => {
    if (restSeconds <= 0 || status !== 'active' || showEndConfirm) return;
    const timer = setInterval(() => setRestSeconds((current) => Math.max(0, current - 1)), 1000);
    return () => clearInterval(timer);
  }, [restSeconds, showEndConfirm, status]);

  const finishWorkout = () => {
    router.replace({
      pathname: '/features/exercise/[mode]/summary',
      params: { mode: 'strength', seconds: String(elapsedSeconds) },
    } as Href);
  };

  const completeSet = () => {
    if (completedSets + 1 < currentExercise.sets) {
      setCompletedSets((current) => current + 1);
      setRestSeconds(45);
      return;
    }

    if (nextExercise) {
      setExerciseIndex((current) => current + 1);
      setCompletedSets(0);
      setRestSeconds(45);
      return;
    }

    finishWorkout();
  };

  return (
    <AppScreen backgroundColor={workoutAccent.background} includeBottomInset>
      <NavHeader
        onBack={() => setShowEndConfirm(true)}
        right={
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => setShowEndConfirm(true)}
            style={({ pressed }) => pressed && styles.headerActionPressed}
          >
            <Text style={styles.endHeaderAction}>结束</Text>
          </Pressable>
        }
        title="力量训练"
      />

      <ScrollView contentContainerStyle={styles.strengthContent} showsVerticalScrollIndicator={false}>
        <View style={styles.planProgressHeader}>
          <View>
            <Text style={styles.planName}>全身入门 · 25 分钟</Text>
            <Text style={styles.planProgressValue}>
              <Text style={styles.planProgressCurrent}>{exerciseIndex + 1}</Text> / 6 个动作
            </Text>
          </View>
          <View style={styles.elapsedWrap}>
            <Text style={styles.elapsedLabel}>已用时</Text>
            <Text style={styles.elapsedValue}>{formatWorkoutDuration(elapsedSeconds)}</Text>
          </View>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>

        <View style={styles.strengthToolbar}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setStatus((current) => (current === 'active' ? 'paused' : 'active'))}
            style={({ pressed }) => [styles.toolbarButton, pressed && styles.toolbarButtonPressed]}
          >
            <AppIcon
              color={colors.primaryStrong}
              name={status === 'active' ? 'pause-outline' : 'play-outline'}
              size={18}
            />
            <Text style={styles.toolbarButtonText}>{status === 'active' ? '暂停训练' : '继续训练'}</Text>
          </Pressable>
          <Text style={styles.toolbarStatus}>{status === 'active' ? '训练中' : '已暂停'}</Text>
        </View>

        <View style={styles.exerciseHero}>
          <View style={styles.exerciseHeroCopy}>
            <View style={styles.exerciseTitleLine}>
              <Text accessibilityRole="header" style={styles.activeExerciseTitle}>
                {currentExercise.title}
              </Text>
              <View style={styles.setBadge}>
                <Text style={styles.setBadgeText}>第 {Math.min(completedSets + 1, 3)} 组</Text>
              </View>
            </View>
            <Text style={styles.activeExerciseCue}>{currentExercise.cue}</Text>
            {/* 常见错误比动作要领更重要：姿势错造成的损伤是练几周后才疼的，
                那时用户根本不会把它和这个 App 联系起来。 */}
            <View style={styles.mistakeRow}>
              <AppIcon color={workoutAccent.coral} name="alert-circle-outline" size={14} />
              <Text style={styles.mistakeText}>{currentExercise.mistake}</Text>
            </View>
          </View>
          <View style={styles.exerciseFigure}>
            <AppIcon color={colors.primaryStrong} name={currentExercise.icon} size={74} />
            <View style={styles.figureDirection}>
              <AppIcon color={colors.primary} name="arrow-down" size={19} />
            </View>
          </View>
        </View>

        <View style={styles.setTable}>
          <View style={styles.setTableHeader}>
            <Text style={[styles.tableHeaderText, styles.setColumn]}>组数</Text>
            <Text style={styles.tableHeaderText}>
              {currentExercise.measure.kind === 'reps' ? '次数' : '时长'}
            </Text>
            <Text style={styles.tableHeaderText}>负重</Text>
            <Text style={[styles.tableHeaderText, styles.statusColumn]}>状态</Text>
          </View>
          {Array.from({ length: currentExercise.sets }).map((_, index) => {
            const completed = index < completedSets;
            const active = index === completedSets;
            return (
              <View key={index} style={styles.setRow}>
                <View
                  style={[
                    styles.setNumber,
                    completed && styles.setNumberCompleted,
                    active && styles.setNumberActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.setNumberText,
                      completed && styles.setNumberTextCompleted,
                      active && styles.setNumberTextCurrent,
                    ]}
                  >
                    {index + 1}
                  </Text>
                </View>
                <Text style={styles.setCell}>{describeMeasure(currentExercise.measure)}</Text>
                <Text style={styles.setCell}>自重</Text>
                <View style={styles.setStatusCell}>
                  {completed ? (
                    <>
                      <AppIcon color={colors.primary} name="checkmark-circle" size={18} />
                      <Text style={styles.completedText}>完成</Text>
                    </>
                  ) : active ? (
                    <>
                      <View style={styles.activeSetDot} />
                      <Text style={styles.activeSetText}>进行中</Text>
                    </>
                  ) : (
                    <Text style={styles.waitingText}>待开始</Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>

        <WorkoutPrimaryButton
          disabled={status === 'paused'}
          label={status === 'paused' ? '继续训练后完成本组' : '完成本组'}
          onPress={completeSet}
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => setRestSeconds((current) => (current > 0 ? 0 : 45))}
          style={({ pressed }) => [styles.restControl, pressed && styles.toolbarButtonPressed]}
        >
          <AppIcon color={colors.primaryStrong} name="time-outline" size={20} />
          <Text style={styles.restControlText}>
            {restSeconds > 0 ? `休息中 ${formatWorkoutDuration(restSeconds)}` : '休息计时 00:45'}
          </Text>
          {restSeconds > 0 ? <Text style={styles.skipRest}>跳过</Text> : null}
        </Pressable>

        <WorkoutDivider />
        <View style={styles.nextExercise}>
          <View>
            <Text style={styles.nextLabel}>{nextExercise ? '下一项' : '最后一个动作'}</Text>
            <Text style={styles.nextTitle}>
              {nextExercise?.title ?? currentExercise.title}
              <Text style={styles.nextMeta}>
                {' · '}
                {describeVolume(nextExercise ?? currentExercise)}
              </Text>
            </Text>
          </View>
          <AppIcon color={colors.borderStrong} name="chevron-forward" size={19} />
        </View>
      </ScrollView>

      {showEndConfirm ? (
        <EndWorkoutSheet
          onContinue={() => setShowEndConfirm(false)}
          onFinish={finishWorkout}
          title="结束力量训练？"
        />
      ) : null}
    </AppScreen>
  );
}

function EndWorkoutSheet({
  title,
  onContinue,
  onFinish,
}: {
  title: string;
  onContinue: () => void;
  onFinish: () => void;
}) {
  return (
    <View accessibilityViewIsModal style={styles.sheetLayer}>
      <Pressable accessibilityLabel="关闭结束确认" onPress={onContinue} style={styles.sheetBackdrop} />
      <View style={styles.endSheet}>
        <View style={styles.sheetHandle} />
        <Text accessibilityRole="header" style={styles.sheetTitle}>
          {title}
        </Text>
        <Text style={styles.sheetCopy}>结束后仍可以查看本次总结并选择是否保存记录。</Text>
        <WorkoutPrimaryButton label="继续运动" onPress={onContinue} />
        <Pressable
          accessibilityRole="button"
          onPress={onFinish}
          style={({ pressed }) => [styles.finishButton, pressed && styles.finishButtonPressed]}
        >
          <Text style={styles.finishButtonText}>结束并查看总结</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mistakeRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  mistakeText: {
    flex: 1,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 19,
  },
  lockButton: {
    width: 44,
    height: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  outdoorBody: {
    flex: 1,
  },
  mapWrap: {
    position: 'relative',
  },
  liveBadge: {
    position: 'absolute',
    left: 14,
    top: 14,
    minHeight: 32,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  liveBadgeText: {
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  goalBadge: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    minHeight: 32,
    paddingHorizontal: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
  },
  goalBadgeText: {
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  outdoorTray: {
    flex: 1,
    minHeight: 390,
    marginTop: -18,
    paddingTop: 25,
    paddingHorizontal: 16,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: workoutAccent.background,
  },
  distanceLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
  },
  distanceValue: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 64,
    lineHeight: 72,
    fontWeight: '700',
    letterSpacing: -2,
    fontVariant: ['tabular-nums'],
  },
  distanceUnit: {
    marginLeft: 8,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '600',
  },
  metricStrip: {
    minHeight: 76,
    marginTop: 8,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  },
  metricDivider: {
    width: StyleSheet.hairlineWidth,
    height: 38,
    backgroundColor: workoutAccent.hairline,
  },
  currentMetric: {
    marginTop: 14,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  currentMetricValue: {
    color: colors.primaryStrong,
    fontWeight: '700',
  },
  outdoorControls: {
    minHeight: 112,
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  pauseButton: {
    width: 96,
    height: 96,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  pauseButtonText: {
    marginTop: 2,
    color: colors.background,
    fontFamily,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
  },
  stopButton: {
    width: 96,
    height: 96,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: workoutAccent.coral,
    backgroundColor: workoutAccent.coralSoft,
  },
  stopSquare: {
    width: 21,
    height: 21,
    borderRadius: 5,
    backgroundColor: workoutAccent.coral,
  },
  stopLabel: {
    marginTop: 6,
    color: workoutAccent.coral,
    fontFamily,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
  },
  controlPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.97 }],
  },
  announcement: {
    alignSelf: 'center',
    minHeight: 42,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: workoutAccent.hairline,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
  },
  announcementText: {
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
  },
  endHeaderAction: {
    color: workoutAccent.coral,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  headerActionPressed: {
    opacity: 0.55,
  },
  strengthContent: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 30,
    gap: 12,
  },
  planProgressHeader: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  planName: {
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
  },
  planProgressValue: {
    marginTop: 5,
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  planProgressCurrent: {
    color: colors.primaryStrong,
    fontSize: 27,
    fontWeight: '700',
  },
  elapsedWrap: {
    alignItems: 'flex-end',
  },
  elapsedLabel: {
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  elapsedValue: {
    marginTop: 4,
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 22,
    lineHeight: 29,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  progressTrack: {
    height: 6,
    overflow: 'hidden',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  strengthToolbar: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toolbarButton: {
    minHeight: 44,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  toolbarButtonPressed: {
    opacity: 0.6,
  },
  toolbarButtonText: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  toolbarStatus: {
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
  },
  exerciseHero: {
    minHeight: 180,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  },
  exerciseHeroCopy: {
    flex: 1,
    minWidth: 0,
  },
  exerciseTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  activeExerciseTitle: {
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 27,
    lineHeight: 35,
    fontWeight: '700',
  },
  setBadge: {
    minHeight: 30,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
  },
  setBadgeText: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  activeExerciseCue: {
    marginTop: 14,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 13,
    lineHeight: 21,
  },
  exerciseFigure: {
    width: 104,
    height: 126,
    marginLeft: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
  },
  figureDirection: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  setTable: {
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  },
  setTableHeader: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: workoutAccent.hairline,
  },
  tableHeaderText: {
    flex: 1,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  setColumn: {
    textAlign: 'left',
  },
  statusColumn: {
    textAlign: 'right',
  },
  setRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: workoutAccent.hairline,
  },
  setNumber: {
    width: 32,
    height: 32,
    marginRight: 8,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  setNumberCompleted: {
    backgroundColor: colors.primarySoft,
  },
  setNumberActive: {
    backgroundColor: colors.primary,
  },
  setNumberText: {
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  setNumberTextCompleted: {
    color: colors.primaryStrong,
  },
  setNumberTextCurrent: {
    color: colors.background,
  },
  setCell: {
    flex: 1,
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  setStatusCell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 5,
  },
  completedText: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  activeSetDot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  activeSetText: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  waitingText: {
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
  },
  restControl: {
    minHeight: 50,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: workoutAccent.hairline,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  restControlText: {
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  skipRest: {
    position: 'absolute',
    right: 16,
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  nextExercise: {
    minHeight: 72,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  nextLabel: {
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  nextTitle: {
    marginTop: 4,
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  nextMeta: {
    color: workoutAccent.muted,
    fontWeight: '400',
  },
  sheetLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 20,
    justifyContent: 'flex-end',
  },
  sheetBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(23, 32, 27, 0.34)',
  },
  endSheet: {
    paddingTop: 10,
    paddingHorizontal: 18,
    paddingBottom: 20,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.background,
  },
  sheetHandle: {
    width: 38,
    height: 4,
    alignSelf: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
  },
  sheetTitle: {
    marginTop: 19,
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 21,
    lineHeight: 29,
    fontWeight: '700',
    textAlign: 'center',
  },
  sheetCopy: {
    marginTop: 7,
    marginBottom: 18,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  finishButton: {
    minHeight: 50,
    marginTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: workoutAccent.coralSoft,
  },
  finishButtonPressed: {
    opacity: 0.68,
  },
  finishButtonText: {
    color: workoutAccent.coral,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
});
