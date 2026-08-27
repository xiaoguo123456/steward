import { Stack, type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

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
import { useOutdoorWorkoutTracking } from '@/features/workouts/use-outdoor-workout-tracking';
import { useWorkoutVoice } from '@/features/workouts/use-workout-voice';
import {
  formatAveragePace,
  formatAverageSpeed,
  formatDistanceKilometers,
} from '@/features/workouts/workout-location';
import {
  createKilometerAnnouncement,
  createWorkoutFinishAnnouncement,
  createWorkoutGoalAnnouncement,
  createWorkoutPauseAnnouncement,
  createWorkoutResumeAnnouncement,
  createWorkoutStartAnnouncement,
  parseWorkoutGoal,
} from '@/features/workouts/workout-voice';
import { useClientReady } from '@/hooks/use-client-ready';
import { colors, fontFamily, radius } from '@/theme/tokens';

const OUTDOOR_TRAY_OVERLAP = 18;
const OUTDOOR_MAP_MESSAGE_GAP = 14;

type ActiveStatus = 'active' | 'paused';
type OutdoorActiveStatus = 'locating' | ActiveStatus;

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
    return (
      <>
        <Stack.Screen options={{ gestureEnabled: false }} />
        <OutdoorActiveWorkout mode={mode} params={params} />
      </>
    );
  }

  const planId = Array.isArray(params.plan) ? params.plan[0] : params.plan;
  return (
    <>
      <Stack.Screen options={{ gestureEnabled: false }} />
      <StrengthActiveWorkout planId={planId} />
    </>
  );
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
  const [status, setStatus] = useState<OutdoorActiveStatus>('locating');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [confirmIntent, setConfirmIntent] = useState<'back' | 'finish' | null>(null);
  const startAttemptRef = useRef(0);
  const mountedRef = useRef(true);
  const lastAnnouncedKilometerRef = useRef(0);
  const lastKilometerElapsedRef = useRef(0);
  const goalAnnouncedRef = useRef(false);
  const goalParam = Array.isArray(params.goal) ? params.goal[0] : params.goal;
  const voiceParam = Array.isArray(params.voice) ? params.voice[0] : params.voice;
  const goal = clientReady ? goalParam : undefined;
  const voiceEnabled = voiceParam !== '0';
  const workoutGoal = useMemo(() => parseWorkoutGoal(goal), [goal]);
  const { announce, stop: stopVoice } = useWorkoutVoice(voiceEnabled);
  const modeDefinition = workoutModes.find((item) => item.id === mode) ?? workoutModes[0];
  const tracking = useOutdoorWorkoutTracking({
    enabled: status !== 'paused' && confirmIntent === null,
    mode,
    recording: status === 'active' && confirmIntent === null,
  });
  const distanceText = formatDistanceKilometers(tracking.distanceMeters);
  const isCycling = mode === 'cycling';
  const paceOrSpeed = isCycling
    ? formatAverageSpeed(elapsedSeconds, tracking.distanceMeters)
    : formatAveragePace(elapsedSeconds, tracking.distanceMeters);
  const trackingActionLabel =
    tracking.action === 'settings' ? '打开设置' : tracking.action === 'retry' ? '重试' : undefined;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      startAttemptRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (status !== 'locating' || !tracking.hasFix || confirmIntent !== null) return;

    const attempt = startAttemptRef.current + 1;
    startAttemptRef.current = attempt;
    void announce(createWorkoutStartAnnouncement(mode)).then(() => {
      if (mountedRef.current && startAttemptRef.current === attempt) {
        setStatus('active');
      }
    });
  }, [announce, confirmIntent, mode, status, tracking.hasFix]);

  useEffect(() => {
    if (status !== 'active' || confirmIntent !== null) return;
    const timer = setInterval(() => setElapsedSeconds((current) => current + 1), 1000);
    return () => clearInterval(timer);
  }, [confirmIntent, status]);

  useEffect(() => {
    if (status !== 'active') return;
    const completedKilometers = Math.floor(tracking.distanceMeters / 1000);
    const previousKilometers = lastAnnouncedKilometerRef.current;
    if (completedKilometers <= previousKilometers) return;

    const kilometerCount = completedKilometers - previousKilometers;
    const kilometerSeconds = Math.max(
      1,
      (elapsedSeconds - lastKilometerElapsedRef.current) / kilometerCount,
    );
    lastAnnouncedKilometerRef.current = completedKilometers;
    lastKilometerElapsedRef.current = elapsedSeconds;
    void announce(
      createKilometerAnnouncement({
        completedKilometers,
        elapsedSeconds,
        kilometerSeconds,
        mode,
      }),
      { interrupt: false },
    );
  }, [announce, elapsedSeconds, mode, status, tracking.distanceMeters]);

  useEffect(() => {
    if (!workoutGoal || goalAnnouncedRef.current || status !== 'active') return;
    const completed =
      workoutGoal.kind === 'distance'
        ? tracking.distanceMeters >= workoutGoal.meters
        : elapsedSeconds >= workoutGoal.seconds;
    if (!completed) return;

    goalAnnouncedRef.current = true;
    void announce(createWorkoutGoalAnnouncement(workoutGoal), { interrupt: false });
  }, [announce, elapsedSeconds, status, tracking.distanceMeters, workoutGoal]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (confirmIntent !== null) {
        setConfirmIntent(null);
      } else {
        startAttemptRef.current += 1;
        void stopVoice();
        setConfirmIntent('back');
      }
      return true;
    });
    return () => subscription.remove();
  }, [confirmIntent, status, stopVoice]);

  const finishWorkout = () => {
    startAttemptRef.current += 1;
    void announce(
      createWorkoutFinishAnnouncement({
        distanceMeters: tracking.distanceMeters,
        elapsedSeconds,
      }),
    );
    router.replace({
      pathname: '/features/exercise/[mode]/summary',
      params: {
        mode,
        seconds: String(elapsedSeconds),
        distanceMeters: String(Math.round(tracking.distanceMeters)),
      },
    } as Href);
  };

  const openConfirmation = (intent: 'back' | 'finish') => {
    startAttemptRef.current += 1;
    void stopVoice();
    setConfirmIntent(intent);
  };

  const togglePause = () => {
    if (status === 'active') {
      setStatus('paused');
      void announce(createWorkoutPauseAnnouncement());
      return;
    }
    if (status === 'paused') {
      setStatus('active');
      void announce(createWorkoutResumeAnnouncement());
    }
  };

  const statusLabel =
    status === 'locating'
      ? tracking.hasFix
        ? '即将开始'
        : '定位中'
      : status === 'active'
        ? '记录中'
        : '已暂停';
  const canPause = status === 'active' || status === 'paused';

  const handleTrackingAction = () => {
    if (tracking.action === 'settings') {
      void Linking.openSettings();
      return;
    }
    tracking.retry();
  };

  return (
    <AppScreen backgroundColor={workoutAccent.background} includeBottomInset>
      <NavHeader
        onBack={() => openConfirmation('back')}
        right={
          <View style={styles.lockButton}>
            <AppIcon color={workoutAccent.ink} name="lock-closed-outline" size={19} />
          </View>
        }
        title={modeDefinition.label}
      />

      <View style={styles.outdoorBody}>
        <View style={styles.mapWrap}>
          <RouteMap
            actionLabel={trackingActionLabel}
            currentPoint={tracking.currentPoint}
            distanceMeters={tracking.distanceMeters}
            locationMessageBottomInset={OUTDOOR_TRAY_OVERLAP + OUTDOOR_MAP_MESSAGE_GAP}
            onAction={trackingActionLabel ? handleTrackingAction : undefined}
            routeSegments={tracking.routeSegments}
            statusMessage={tracking.message}
            trackingStatus={tracking.status}
          />
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveBadgeText}>{statusLabel}</Text>
          </View>
          {goal ? (
            <View style={styles.goalBadge}>
              <Text style={styles.goalBadgeText}>目标 · {goal}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.outdoorTray}>
          <View style={styles.distanceLine}>
            <Text style={styles.distanceValue}>{distanceText}</Text>
            <Text style={styles.distanceUnit}>公里</Text>
          </View>

          <View style={styles.metricStrip}>
            <OutdoorMetric label="运动时间" value={formatWorkoutDuration(elapsedSeconds)} />
            <View style={styles.metricDivider} />
            <OutdoorMetric
              label={isCycling ? '平均速度（公里/时）' : '平均配速（每公里）'}
              value={paceOrSpeed}
            />
          </View>

          <View style={styles.outdoorControls}>
            <Pressable
              accessibilityLabel={
                canPause ? (status === 'active' ? '暂停运动' : '继续运动') : '正在等待 GPS 信号'
              }
              accessibilityRole="button"
              disabled={!canPause}
              onPress={togglePause}
              style={({ pressed }) => [
                styles.pauseButton,
                !canPause && styles.pauseButtonDisabled,
                pressed && canPause && styles.controlPressed,
              ]}
            >
              <AppIcon
                color={canPause ? colors.background : workoutAccent.muted}
                name={!canPause ? 'navigate-outline' : status === 'active' ? 'pause' : 'play'}
                size={36}
              />
              <Text style={[styles.pauseButtonText, !canPause && styles.pauseButtonTextDisabled]}>
                {!canPause ? '定位中' : status === 'active' ? '暂停' : '继续'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel="结束运动"
              accessibilityRole="button"
              onPress={() => openConfirmation('finish')}
              style={({ pressed }) => [styles.stopButton, pressed && styles.controlPressed]}
            >
              <View style={styles.stopSquare} />
              <Text style={styles.stopLabel}>结束</Text>
            </Pressable>
          </View>
        </View>
      </View>

      {confirmIntent ? (
        <EndWorkoutSheet
          finishLabel={confirmIntent === 'back' ? '停止并退出' : '结束并查看总结'}
          onContinue={() => setConfirmIntent(null)}
          onFinish={finishWorkout}
          title={
            confirmIntent === 'back'
              ? `停止并退出${modeDefinition.label}？`
              : `结束${modeDefinition.label}？`
          }
        />
      ) : null}
    </AppScreen>
  );
}

function OutdoorMetric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.outdoorMetric}>
      <Text style={styles.outdoorMetricValue}>{value}</Text>
      <Text style={styles.outdoorMetricLabel}>{label}</Text>
    </View>
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

  useEffect(() => {
    if (!currentExercise || status !== 'active' || showEndConfirm) return;
    const timer = setInterval(() => setElapsedSeconds((current) => current + 1), 1000);
    return () => clearInterval(timer);
  }, [currentExercise, showEndConfirm, status]);

  useEffect(() => {
    if (restSeconds <= 0 || status !== 'active' || showEndConfirm) return;
    const timer = setInterval(() => setRestSeconds((current) => Math.max(0, current - 1)), 1000);
    return () => clearInterval(timer);
  }, [restSeconds, showEndConfirm, status]);

  useEffect(() => {
    if (!currentExercise) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setShowEndConfirm((current) => !current);
      return true;
    });
    return () => subscription.remove();
  }, [currentExercise]);

  const finishWorkout = () => {
    router.replace({
      pathname: '/features/exercise/[mode]/summary',
      params: { mode: 'strength', seconds: String(elapsedSeconds) },
    } as Href);
  };

  if (!currentExercise) {
    return (
      <AppScreen backgroundColor={workoutAccent.background} includeBottomInset>
        <NavHeader title="力量训练" />
        <View style={styles.unavailableState}>
          <View style={styles.unavailableIcon}>
            <AppIcon color={workoutAccent.muted} name="alert-circle-outline" size={30} />
          </View>
          <Text accessibilityRole="header" style={styles.unavailableTitle}>
            训练计划暂时不可用
          </Text>
          <Text style={styles.unavailableCopy}>
            这份计划没有可执行的动作，请返回训练准备页重新选择。
          </Text>
          <View style={styles.unavailableButton}>
            <WorkoutPrimaryButton label="返回训练准备" onPress={() => router.back()} />
          </View>
        </View>
      </AppScreen>
    );
  }

  const progress = totalSets > 0 ? Math.min(1, completedTotal / totalSets) : 0;

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
            <Text style={styles.planName}>{plan.label} · {plan.duration}</Text>
            <Text style={styles.planProgressValue}>
              <Text style={styles.planProgressCurrent}>{exerciseIndex + 1}</Text> /{' '}
              {strengthExercises.length} 个动作
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
          finishLabel="结束并查看总结"
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
  finishLabel,
  onContinue,
  onFinish,
}: {
  title: string;
  finishLabel: string;
  onContinue: () => void;
  onFinish: () => void;
}) {
  return (
    <Modal
      animationType="slide"
      onRequestClose={onContinue}
      statusBarTranslucent
      transparent
      visible
    >
      <View accessibilityViewIsModal style={styles.sheetLayer}>
        <Pressable
          accessibilityLabel="关闭结束确认"
          onPress={onContinue}
          style={styles.sheetBackdrop}
        />
        <View style={styles.endSheet}>
          <View style={styles.sheetHandle} />
          <Text accessibilityRole="header" style={styles.sheetTitle}>
            {title}
          </Text>
          <Text style={styles.sheetCopy}>停止后会进入运动总结，由你确认是否保存记录。</Text>
          <WorkoutPrimaryButton label="继续运动" onPress={onContinue} />
          <Pressable
            accessibilityRole="button"
            onPress={onFinish}
            style={({ pressed }) => [styles.finishButton, pressed && styles.finishButtonPressed]}
          >
            <Text style={styles.finishButtonText}>{finishLabel}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
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
    flex: 1,
    minHeight: 240,
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
    top: 14,
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
    marginTop: -OUTDOOR_TRAY_OVERLAP,
    paddingTop: 24,
    paddingHorizontal: 16,
    paddingBottom: 18,
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
    fontSize: 58,
    lineHeight: 66,
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
    minHeight: 68,
    marginTop: 5,
    paddingVertical: 8,
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
  outdoorMetric: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outdoorMetricValue: {
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 21,
    lineHeight: 28,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  outdoorMetricLabel: {
    marginTop: 2,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
  },
  outdoorControls: {
    minHeight: 102,
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 48,
  },
  pauseButton: {
    width: 90,
    height: 90,
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
  pauseButtonDisabled: {
    backgroundColor: colors.surface,
  },
  pauseButtonTextDisabled: {
    color: workoutAccent.muted,
  },
  stopButton: {
    width: 90,
    height: 90,
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
  unavailableState: {
    flex: 1,
    paddingHorizontal: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unavailableIcon: {
    width: 58,
    height: 58,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  unavailableTitle: {
    marginTop: 16,
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '700',
  },
  unavailableCopy: {
    marginTop: 7,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  unavailableButton: {
    minWidth: 168,
    marginTop: 20,
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
    minHeight: 52,
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
