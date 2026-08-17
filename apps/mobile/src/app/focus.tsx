import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { FocusRing } from '@/features/focus/components/focus-ring';
import { FocusSheet } from '@/features/focus/components/focus-sheet';
import { useFocusPrototype } from '@/features/focus/focus-context';
import { focusTaskOptions } from '@/features/focus/mock-data';
import {
  formatFocusClock,
  formatFocusDuration,
  isSameLocalDay,
  type FocusMode,
  type FocusQuality,
  type FocusTaskReference,
  type FocusThought,
} from '@/features/focus/model';
import { colors, fontFamily, radius } from '@/theme/tokens';

type FocusPhase = 'ready' | 'focus' | 'focusComplete' | 'break' | 'summary';
type FocusView = 'session' | 'history';
type FocusButtonTone = 'primary' | 'neutral' | 'danger';

const DURATION_OPTIONS = [25, 45, 60] as const;
const DEFAULT_BREAK_SECONDS = 5 * 60;

const qualityOptions: { id: FocusQuality; label: string }[] = [
  { id: 'smooth', label: '很顺畅' },
  { id: 'normal', label: '还可以' },
  { id: 'distracted', label: '有些分心' },
];

const qualityLabels: Record<FocusQuality, string> = {
  smooth: '很顺畅',
  normal: '还可以',
  distracted: '有些分心',
};

export default function FocusScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { records, saveRecord } = useFocusPrototype();
  const lastTickAtRef = useRef<number | null>(null);
  const [view, setView] = useState<FocusView>('session');
  const [phase, setPhase] = useState<FocusPhase>('ready');
  const [mode, setMode] = useState<FocusMode>('pomodoro');
  const [durationMinutes, setDurationMinutes] = useState(25);
  const [customMinutes, setCustomMinutes] = useState(35);
  const [selectedTask, setSelectedTask] = useState<FocusTaskReference | null>(
    focusTaskOptions[0] ?? null,
  );
  const [remainingSeconds, setRemainingSeconds] = useState(25 * 60);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [breakRemainingSeconds, setBreakRemainingSeconds] = useState(DEFAULT_BREAK_SECONDS);
  const [breakTotalSeconds, setBreakTotalSeconds] = useState(DEFAULT_BREAK_SECONDS);
  const [running, setRunning] = useState(false);
  const [thoughts, setThoughts] = useState<FocusThought[]>([]);
  const [thoughtDraft, setThoughtDraft] = useState('');
  const [temporaryTaskDraft, setTemporaryTaskDraft] = useState('');
  const [taskCompleted, setTaskCompleted] = useState(false);
  const [quality, setQuality] = useState<FocusQuality | null>(null);
  const [recordSaved, setRecordSaved] = useState(false);
  const [showTaskSheet, setShowTaskSheet] = useState(false);
  const [showDurationSheet, setShowDurationSheet] = useState(false);
  const [showThoughtSheet, setShowThoughtSheet] = useState(false);
  const [showEndSheet, setShowEndSheet] = useState(false);

  const ringSize = Math.min(252, Math.max(220, width - 96));
  const plannedSeconds = durationMinutes * 60;
  const todayRecords = useMemo(
    () => records.filter((record) => isSameLocalDay(record.completedAt)),
    [records],
  );
  const todaySeconds = useMemo(
    () => todayRecords.reduce((total, record) => total + record.elapsedSeconds, 0),
    [todayRecords],
  );

  useEffect(() => {
    if (!running || (phase !== 'focus' && phase !== 'break')) return;

    if (lastTickAtRef.current === null) lastTickAtRef.current = Date.now();

    const timer = setInterval(() => {
      const now = Date.now();
      const previousTick = lastTickAtRef.current ?? now;
      const elapsedWholeSeconds = Math.floor((now - previousTick) / 1000);
      if (elapsedWholeSeconds < 1) return;
      lastTickAtRef.current = previousTick + elapsedWholeSeconds * 1000;

      if (phase === 'focus') {
        const appliedSeconds =
          mode === 'pomodoro'
            ? Math.min(elapsedWholeSeconds, remainingSeconds)
            : elapsedWholeSeconds;
        setElapsedSeconds((current) => current + appliedSeconds);
        if (mode === 'pomodoro') {
          if (remainingSeconds <= elapsedWholeSeconds) {
            setRemainingSeconds(0);
            lastTickAtRef.current = null;
            setRunning(false);
            setPhase('focusComplete');
          } else {
            setRemainingSeconds(remainingSeconds - elapsedWholeSeconds);
          }
        }
      } else {
        if (breakRemainingSeconds <= elapsedWholeSeconds) {
          setBreakRemainingSeconds(0);
          lastTickAtRef.current = null;
          setRunning(false);
          setPhase('summary');
        } else {
          setBreakRemainingSeconds(breakRemainingSeconds - elapsedWholeSeconds);
        }
      }
    }, 250);

    return () => clearInterval(timer);
  }, [breakRemainingSeconds, mode, phase, remainingSeconds, running]);

  const changeMode = (nextMode: FocusMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    lastTickAtRef.current = null;
    setRunning(false);
    setElapsedSeconds(0);
    setRemainingSeconds(durationMinutes * 60);
    setRecordSaved(false);
  };

  const chooseDuration = (minutes: number) => {
    setDurationMinutes(minutes);
    setRemainingSeconds(minutes * 60);
    setRecordSaved(false);
  };

  const startFocus = () => {
    setElapsedSeconds(0);
    setRemainingSeconds(durationMinutes * 60);
    setThoughts([]);
    setTaskCompleted(false);
    setQuality(null);
    setRecordSaved(false);
    setPhase('focus');
    lastTickAtRef.current = Date.now();
    setRunning(true);
  };

  const startBreak = () => {
    setBreakRemainingSeconds(DEFAULT_BREAK_SECONDS);
    setBreakTotalSeconds(DEFAULT_BREAK_SECONDS);
    setPhase('break');
    lastTickAtRef.current = Date.now();
    setRunning(true);
  };

  const finishFocus = () => {
    lastTickAtRef.current = null;
    setRunning(false);
    setShowEndSheet(false);
    setPhase('summary');
  };

  const skipBreak = () => {
    lastTickAtRef.current = null;
    setRunning(false);
    setPhase('summary');
  };

  const saveSession = () => {
    saveRecord({
      task: selectedTask,
      mode,
      plannedSeconds: mode === 'pomodoro' ? plannedSeconds : undefined,
      elapsedSeconds,
      completedAt: new Date().toISOString(),
      taskCompleted,
      quality,
      thoughts,
    });
    lastTickAtRef.current = null;
    setRunning(false);
    setPhase('ready');
    setElapsedSeconds(0);
    setRemainingSeconds(durationMinutes * 60);
    setThoughts([]);
    setThoughtDraft('');
    setTaskCompleted(false);
    setQuality(null);
    setRecordSaved(true);
  };

  const saveThought = () => {
    const content = thoughtDraft.trim();
    if (!content) return;
    setThoughts((current) => [
      ...current,
      {
        id: `thought-${Date.now()}-${current.length}`,
        content,
        capturedAtSeconds: elapsedSeconds,
      },
    ]);
    setThoughtDraft('');
    setShowThoughtSheet(false);
  };

  const useTemporaryTask = () => {
    const title = temporaryTaskDraft.trim();
    if (!title) return;
    setSelectedTask({
      id: `temporary-${Date.now()}`,
      title,
      list: '临时事项',
      color: colors.primary,
      temporary: true,
    });
    setTemporaryTaskDraft('');
    setShowTaskSheet(false);
  };

  const resetToReady = () => {
    lastTickAtRef.current = null;
    setRunning(false);
    setPhase('ready');
    setElapsedSeconds(0);
    setRemainingSeconds(durationMinutes * 60);
    setBreakRemainingSeconds(DEFAULT_BREAK_SECONDS);
    setThoughts([]);
    setThoughtDraft('');
    setTaskCompleted(false);
    setQuality(null);
  };

  const toggleRunning = () => {
    const nextRunning = !running;
    lastTickAtRef.current = nextRunning ? Date.now() : null;
    setRunning(nextRunning);
  };

  const handleBack = () => {
    if (view === 'history') {
      setView('session');
      return;
    }
    if (phase === 'focus') {
      setShowEndSheet(true);
      return;
    }
    if (phase === 'break') {
      skipBreak();
      return;
    }
    if (phase === 'focusComplete') {
      setPhase('summary');
      return;
    }
    if (phase === 'summary') {
      resetToReady();
      return;
    }
    router.back();
  };

  const readyTime = mode === 'pomodoro' ? durationMinutes * 60 : 0;
  const activeTime = mode === 'pomodoro' ? remainingSeconds : elapsedSeconds;
  const focusProgress =
    mode === 'pomodoro'
      ? remainingSeconds / Math.max(1, plannedSeconds)
      : Math.min(1, (elapsedSeconds % 3600) / 3600);
  const todaySummary =
    todayRecords.length > 0
      ? `今天 ${formatFocusDuration(todaySeconds)} · 已完成 ${todayRecords.length} 次`
      : '今天还没有专注记录';

  if (view === 'history') {
    return (
      <FocusHistory
        onBack={() => setView('session')}
        records={records}
        todayRecordsCount={todayRecords.length}
        todaySeconds={todaySeconds}
      />
    );
  }

  const headerRight =
    phase === 'ready' ? (
      <Pressable
        accessibilityLabel="查看专注记录"
        accessibilityRole="button"
        hitSlop={8}
        onPress={() => setView('history')}
        style={({ pressed }) => pressed && styles.headerPressed}
      >
        <Text style={styles.headerAction}>记录</Text>
      </Pressable>
    ) : phase === 'focus' ? (
      <Pressable
        accessibilityLabel="结束专注"
        accessibilityRole="button"
        hitSlop={8}
        onPress={() => setShowEndSheet(true)}
        style={({ pressed }) => pressed && styles.headerPressed}
      >
        <Text style={styles.headerDanger}>结束</Text>
      </Pressable>
    ) : phase === 'break' ? (
      <Pressable
        accessibilityLabel="跳过休息"
        accessibilityRole="button"
        hitSlop={8}
        onPress={skipBreak}
        style={({ pressed }) => pressed && styles.headerPressed}
      >
        <Text style={styles.headerAction}>跳过</Text>
      </Pressable>
    ) : null;

  return (
    <AppScreen includeBottomInset>
      <NavHeader
        onBack={handleBack}
        right={headerRight}
        title={phase === 'break' ? '休息' : '专注'}
      />

      {phase === 'ready' ? (
        <View style={styles.pageBody}>
          <FocusModeTabs mode={mode} onChange={changeMode} />
          <ScrollView
            contentContainerStyle={styles.readyContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.ringWrap}>
              <FocusRing
                label={mode === 'pomodoro' ? `本次专注 ${durationMinutes} 分钟` : '正向计时'}
                progress={mode === 'pomodoro' ? 1 : 0}
                size={ringSize}
              >
                <Text
                  adjustsFontSizeToFit
                  minimumFontScale={0.68}
                  numberOfLines={1}
                  style={styles.timerText}
                >
                  {formatFocusClock(readyTime)}
                </Text>
                <Text style={styles.timerState}>
                  {mode === 'pomodoro' ? '准备开始' : '正向计时'}
                </Text>
              </FocusRing>
            </View>

            <Pressable
              accessibilityLabel={`选择专注任务，当前为${selectedTask?.title ?? '未关联任务'}`}
              accessibilityRole="button"
              onPress={() => setShowTaskSheet(true)}
              style={({ pressed }) => [styles.taskSelector, pressed && styles.surfacePressed]}
            >
              <View style={styles.taskIcon}>
                <AppIcon color={colors.primaryStrong} name="clipboard-outline" size={22} />
              </View>
              <View style={styles.taskCopy}>
                <Text style={styles.taskLabel}>专注任务</Text>
                <Text numberOfLines={1} style={styles.taskTitle}>
                  {selectedTask?.title ?? '选择一项今天要做的事'}
                </Text>
              </View>
              <AppIcon color={colors.textTertiary} name="chevron-forward" size={19} />
            </Pressable>

            {mode === 'pomodoro' ? (
              <View style={styles.durationSection}>
                <Text accessibilityRole="header" style={styles.blockTitle}>
                  本次时长
                </Text>
                <View style={styles.durationOptions}>
                  {DURATION_OPTIONS.map((minutes, index) => (
                    <View key={minutes} style={styles.durationSlot}>
                      {index > 0 ? <View style={styles.durationDivider} /> : null}
                      <DurationOption
                        label={`${minutes}`}
                        onPress={() => chooseDuration(minutes)}
                        selected={durationMinutes === minutes}
                      />
                    </View>
                  ))}
                  <View style={styles.durationSlot}>
                    <View style={styles.durationDivider} />
                    <DurationOption
                      label="自定义"
                      onPress={() => {
                        setCustomMinutes(durationMinutes);
                        setShowDurationSheet(true);
                      }}
                      selected={!DURATION_OPTIONS.includes(
                        durationMinutes as (typeof DURATION_OPTIONS)[number],
                      )}
                    />
                  </View>
                </View>
              </View>
            ) : null}

            {recordSaved ? (
              <View accessibilityRole="alert" style={styles.savedNotice}>
                <AppIcon color={colors.primaryStrong} name="checkmark-circle" size={19} />
                <Text style={styles.savedNoticeText}>专注记录已保存</Text>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.actionDock}>
            <Text style={styles.todaySummary}>{todaySummary}</Text>
            <FocusButton icon="play" label="开始专注" onPress={startFocus} />
          </View>
        </View>
      ) : null}

      {phase === 'focus' ? (
        <View style={styles.pageBody}>
          <ScrollView
            contentContainerStyle={styles.activeContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.activeMeta}>
              {mode === 'pomodoro' ? `番茄钟 · ${durationMinutes} 分钟` : '正向计时'}
            </Text>
            <Text numberOfLines={2} style={styles.activeTaskTitle}>
              {selectedTask?.title ?? '未关联任务'}
            </Text>

            <View style={styles.activeRingWrap}>
              <FocusRing
                label={`${running ? '专注中' : '已暂停'}，${formatFocusClock(activeTime)}`}
                progress={focusProgress}
                size={ringSize}
              >
                <Text
                  adjustsFontSizeToFit
                  minimumFontScale={0.56}
                  numberOfLines={1}
                  style={styles.timerText}
                >
                  {formatFocusClock(activeTime)}
                </Text>
                <View style={styles.liveStateLine}>
                  <View style={[styles.liveDot, !running && styles.pausedDot]} />
                  <Text style={styles.timerState}>{running ? '专注中' : '已暂停'}</Text>
                </View>
              </FocusRing>
            </View>

            <Pressable
              accessibilityLabel={`记下想法，已记录 ${thoughts.length} 条`}
              accessibilityRole="button"
              onPress={() => setShowThoughtSheet(true)}
              style={({ pressed }) => [styles.thoughtRow, pressed && styles.surfacePressed]}
            >
              <View style={styles.thoughtIcon}>
                <AppIcon color={colors.primaryStrong} name="create-outline" size={20} />
              </View>
              <View style={styles.thoughtCopy}>
                <Text style={styles.thoughtTitle}>记下突然想到的事</Text>
                <Text style={styles.thoughtMeta}>先记下来，稍后再处理</Text>
              </View>
              {thoughts.length > 0 ? (
                <Text style={styles.thoughtCount}>{thoughts.length}</Text>
              ) : null}
              <AppIcon color={colors.textTertiary} name="chevron-forward" size={18} />
            </Pressable>
          </ScrollView>

          <View style={styles.actionDock}>
            <View style={styles.controlRow}>
              <FocusButton
                icon={running ? 'pause' : 'play'}
                label={running ? '暂停' : '继续'}
                onPress={toggleRunning}
                style={styles.controlButton}
              />
              <FocusButton
                icon="stop"
                label="结束"
                onPress={() => setShowEndSheet(true)}
                style={styles.controlButton}
                tone="danger"
              />
            </View>
          </View>
        </View>
      ) : null}

      {phase === 'focusComplete' ? (
        <View style={styles.pageBody}>
          <ScrollView
            contentContainerStyle={styles.completionContent}
            showsVerticalScrollIndicator={false}
          >
            <FocusRing label="本轮专注已完成" progress={1} size={ringSize} tone="complete">
              <View style={styles.completeIcon}>
                <AppIcon color={colors.primaryStrong} name="checkmark" size={34} />
              </View>
            </FocusRing>
            <Text accessibilityRole="header" style={styles.completionTitle}>
              这一轮完成了
            </Text>
            <Text style={styles.completionDuration}>{formatFocusDuration(elapsedSeconds)}</Text>
            <Text numberOfLines={2} style={styles.completionTask}>
              {selectedTask?.title ?? '未关联任务'}
            </Text>
          </ScrollView>
          <View style={styles.actionDock}>
            <FocusButton icon="cafe-outline" label="开始 5 分钟休息" onPress={startBreak} />
            <Pressable
              accessibilityRole="button"
              onPress={() => setPhase('summary')}
              style={({ pressed }) => [styles.textAction, pressed && styles.headerPressed]}
            >
              <Text style={styles.textActionLabel}>暂不休息，保存记录</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {phase === 'break' ? (
        <View style={styles.pageBody}>
          <ScrollView
            contentContainerStyle={styles.breakContent}
            showsVerticalScrollIndicator={false}
          >
            <Text accessibilityRole="header" style={styles.breakTitle}>
              放松一下
            </Text>
            <Text style={styles.breakCopy}>刚才完成了 {formatFocusDuration(elapsedSeconds)} 专注</Text>
            <View style={styles.breakRingWrap}>
              <FocusRing
                label={`${running ? '休息中' : '休息已暂停'}，${formatFocusClock(
                  breakRemainingSeconds,
                )}`}
                progress={breakRemainingSeconds / Math.max(1, breakTotalSeconds)}
                size={ringSize}
                tone="rest"
              >
                <Text
                  adjustsFontSizeToFit
                  minimumFontScale={0.68}
                  numberOfLines={1}
                  style={[styles.timerText, styles.restTimerText]}
                >
                  {formatFocusClock(breakRemainingSeconds)}
                </Text>
                <Text style={styles.timerState}>{running ? '休息中' : '已暂停'}</Text>
              </FocusRing>
            </View>
          </ScrollView>
          <View style={styles.actionDock}>
            <View style={styles.controlRow}>
              <FocusButton
                icon={running ? 'pause' : 'play'}
                label={running ? '暂停休息' : '继续休息'}
                onPress={toggleRunning}
                style={styles.controlButton}
              />
              <FocusButton
                label="延长 5 分钟"
                onPress={() => {
                  setBreakRemainingSeconds((current) => current + DEFAULT_BREAK_SECONDS);
                  setBreakTotalSeconds((current) => current + DEFAULT_BREAK_SECONDS);
                }}
                style={styles.controlButton}
                tone="neutral"
              />
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={skipBreak}
              style={({ pressed }) => [styles.textAction, pressed && styles.headerPressed]}
            >
              <Text style={styles.textActionLabel}>跳过休息</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {phase === 'summary' ? (
        <View style={styles.pageBody}>
          <ScrollView
            contentContainerStyle={styles.summaryContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.summaryMark}>
              <AppIcon color={colors.primaryStrong} name="checkmark" size={28} />
            </View>
            <Text accessibilityRole="header" style={styles.summaryTitle}>
              保存本次专注
            </Text>
            <Text style={styles.summaryDuration}>{formatFocusDuration(elapsedSeconds)}</Text>

            <View style={styles.summaryTaskRow}>
              <View style={styles.summaryTaskIcon}>
                <AppIcon color={colors.primaryStrong} name="clipboard-outline" size={20} />
              </View>
              <View style={styles.taskCopy}>
                <Text style={styles.taskLabel}>专注任务</Text>
                <Text numberOfLines={2} style={styles.summaryTaskTitle}>
                  {selectedTask?.title ?? '未关联任务'}
                </Text>
              </View>
            </View>

            {selectedTask && !selectedTask.temporary ? (
              <View style={styles.summaryBlock}>
                <Text accessibilityRole="header" style={styles.blockTitle}>
                  这个任务完成了吗？
                </Text>
                <View style={styles.radioGroup}>
                  <SummaryRadio
                    label="任务还在继续"
                    onPress={() => setTaskCompleted(false)}
                    selected={!taskCompleted}
                  />
                  <SummaryRadio
                    label="标记任务完成"
                    onPress={() => setTaskCompleted(true)}
                    selected={taskCompleted}
                  />
                </View>
              </View>
            ) : null}

            <View style={styles.summaryBlock}>
              <Text accessibilityRole="header" style={styles.blockTitle}>
                本次状态 <Text style={styles.optionalLabel}>可选</Text>
              </Text>
              <View style={styles.qualityRow}>
                {qualityOptions.map((option) => {
                  const selected = quality === option.id;
                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      key={option.id}
                      onPress={() => setQuality(selected ? null : option.id)}
                      style={({ pressed }) => [
                        styles.qualityOption,
                        selected && styles.qualityOptionSelected,
                        pressed && styles.surfacePressed,
                      ]}
                    >
                      <Text style={[styles.qualityText, selected && styles.qualityTextSelected]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {thoughts.length > 0 ? (
              <View style={styles.summaryThoughts}>
                <AppIcon color={colors.primaryStrong} name="create-outline" size={18} />
                <Text style={styles.summaryThoughtsText}>本次记下 {thoughts.length} 条想法</Text>
              </View>
            ) : null}
          </ScrollView>
          <View style={styles.actionDock}>
            <FocusButton
              disabled={elapsedSeconds <= 0}
              icon="checkmark"
              label="保存专注记录"
              onPress={saveSession}
            />
          </View>
        </View>
      ) : null}

      <FocusSheet
        onClose={() => setShowTaskSheet(false)}
        subtitle="关联任务后，本次专注会按任务归档"
        title="选择专注任务"
        visible={showTaskSheet}
      >
        <View style={styles.temporaryTaskRow}>
          <TextInput
            accessibilityLabel="临时专注事项"
            maxLength={60}
            onChangeText={setTemporaryTaskDraft}
            onSubmitEditing={useTemporaryTask}
            placeholder="也可以输入一件临时事项"
            placeholderTextColor={colors.textTertiary}
            returnKeyType="done"
            selectionColor={colors.primary}
            style={styles.temporaryTaskInput}
            value={temporaryTaskDraft}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !temporaryTaskDraft.trim() }}
            disabled={!temporaryTaskDraft.trim()}
            onPress={useTemporaryTask}
            style={({ pressed }) => [
              styles.useTaskButton,
              !temporaryTaskDraft.trim() && styles.useTaskButtonDisabled,
              pressed && styles.headerPressed,
            ]}
          >
            <Text style={styles.useTaskButtonText}>使用</Text>
          </Pressable>
        </View>
        <Text accessibilityRole="header" style={styles.sheetSectionTitle}>
          今天要做
        </Text>
        <ScrollView keyboardShouldPersistTaps="handled" style={styles.taskSheetList}>
          {focusTaskOptions.map((task) => {
            const selected = selectedTask?.id === task.id;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={task.id}
                onPress={() => {
                  setSelectedTask(task);
                  setShowTaskSheet(false);
                }}
                style={({ pressed }) => [styles.taskSheetRow, pressed && styles.surfacePressed]}
              >
                <View style={[styles.taskListDot, { backgroundColor: task.color }]} />
                <View style={styles.taskCopy}>
                  <Text numberOfLines={2} style={styles.taskSheetTitle}>
                    {task.title}
                  </Text>
                  <Text style={styles.taskSheetMeta}>
                    {task.list}{task.time ? ` · ${task.time}` : ''}
                  </Text>
                </View>
                {selected ? (
                  <AppIcon color={colors.primaryStrong} name="checkmark-circle" size={21} />
                ) : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </FocusSheet>

      <FocusSheet
        onClose={() => setShowDurationSheet(false)}
        subtitle="以 5 分钟为单位调整"
        title="自定义时长"
        visible={showDurationSheet}
      >
        <View style={styles.stepper}>
          <Pressable
            accessibilityLabel="减少 5 分钟"
            accessibilityRole="button"
            accessibilityState={{ disabled: customMinutes <= 5 }}
            disabled={customMinutes <= 5}
            onPress={() => setCustomMinutes((current) => Math.max(5, current - 5))}
            style={({ pressed }) => [
              styles.stepperButton,
              customMinutes <= 5 && styles.stepperButtonDisabled,
              pressed && styles.surfacePressed,
            ]}
          >
            <AppIcon color={colors.text} name="remove" size={24} />
          </Pressable>
          <View style={styles.stepperValue}>
            <Text style={styles.stepperNumber}>{customMinutes}</Text>
            <Text style={styles.stepperUnit}>分钟</Text>
          </View>
          <Pressable
            accessibilityLabel="增加 5 分钟"
            accessibilityRole="button"
            accessibilityState={{ disabled: customMinutes >= 120 }}
            disabled={customMinutes >= 120}
            onPress={() => setCustomMinutes((current) => Math.min(120, current + 5))}
            style={({ pressed }) => [
              styles.stepperButton,
              customMinutes >= 120 && styles.stepperButtonDisabled,
              pressed && styles.surfacePressed,
            ]}
          >
            <AppIcon color={colors.text} name="add" size={24} />
          </Pressable>
        </View>
        <FocusButton
          label="使用此时长"
          onPress={() => {
            chooseDuration(customMinutes);
            setShowDurationSheet(false);
          }}
        />
      </FocusSheet>

      <FocusSheet
        onClose={() => setShowThoughtSheet(false)}
        subtitle={`已专注 ${formatFocusDuration(elapsedSeconds)}`}
        title="记下想法"
        visible={showThoughtSheet}
      >
        <TextInput
          accessibilityLabel="想法内容"
          autoFocus
          maxLength={240}
          multiline
          onChangeText={setThoughtDraft}
          placeholder="先记下来，专注结束后再处理"
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.primary}
          style={styles.thoughtInput}
          textAlignVertical="top"
          value={thoughtDraft}
        />
        <FocusButton
          disabled={!thoughtDraft.trim()}
          label="保存想法"
          onPress={saveThought}
        />
      </FocusSheet>

      <FocusSheet
        onClose={() => setShowEndSheet(false)}
        subtitle={`已专注 ${formatFocusDuration(elapsedSeconds)}`}
        title="结束本次专注？"
        visible={showEndSheet}
      >
        <Text numberOfLines={2} style={styles.endTaskTitle}>
          {selectedTask?.title ?? '未关联任务'}
        </Text>
        <View style={styles.endActions}>
          <FocusButton label="继续专注" onPress={() => setShowEndSheet(false)} />
          <FocusButton label="结束并查看总结" onPress={finishFocus} tone="danger" />
        </View>
      </FocusSheet>
    </AppScreen>
  );
}

function FocusModeTabs({
  mode,
  onChange,
}: {
  mode: FocusMode;
  onChange: (mode: FocusMode) => void;
}) {
  return (
    <View accessibilityLabel="计时方式" style={styles.modeTabs}>
      <Pressable
        accessibilityRole="tab"
        accessibilityState={{ selected: mode === 'pomodoro' }}
        onPress={() => onChange('pomodoro')}
        style={styles.modeTab}
      >
        <Text style={[styles.modeTabText, mode === 'pomodoro' && styles.modeTabTextSelected]}>
          番茄钟
        </Text>
        {mode === 'pomodoro' ? <View style={styles.modeIndicator} /> : null}
      </Pressable>
      <Pressable
        accessibilityRole="tab"
        accessibilityState={{ selected: mode === 'stopwatch' }}
        onPress={() => onChange('stopwatch')}
        style={styles.modeTab}
      >
        <Text style={[styles.modeTabText, mode === 'stopwatch' && styles.modeTabTextSelected]}>
          正向计时
        </Text>
        {mode === 'stopwatch' ? <View style={styles.modeIndicator} /> : null}
      </Pressable>
    </View>
  );
}

function DurationOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.durationOption, pressed && styles.surfacePressed]}
    >
      <Text style={[styles.durationText, selected && styles.durationTextSelected]}>{label}</Text>
      {selected ? <View style={styles.durationDot} /> : null}
    </Pressable>
  );
}

function SummaryRadio({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.radioRow, pressed && styles.surfacePressed]}
    >
      <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
        {selected ? <View style={styles.radioInner} /> : null}
      </View>
      <Text style={styles.radioLabel}>{label}</Text>
    </Pressable>
  );
}

function FocusButton({
  label,
  onPress,
  icon,
  disabled = false,
  tone = 'primary',
  style,
}: {
  label: string;
  onPress: () => void;
  icon?: React.ComponentProps<typeof AppIcon>['name'];
  disabled?: boolean;
  tone?: FocusButtonTone;
  style?: StyleProp<ViewStyle>;
}) {
  const foreground =
    tone === 'primary' ? colors.background : tone === 'danger' ? colors.danger : colors.text;

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        tone === 'neutral' && styles.buttonNeutral,
        tone === 'danger' && styles.buttonDanger,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
        style,
      ]}
    >
      {icon ? <AppIcon color={foreground} name={icon} size={20} /> : null}
      <Text
        style={[
          styles.buttonText,
          tone === 'neutral' && styles.buttonTextNeutral,
          tone === 'danger' && styles.buttonTextDanger,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function FocusHistory({
  records,
  todayRecordsCount,
  todaySeconds,
  onBack,
}: {
  records: ReturnType<typeof useFocusPrototype>['records'];
  todayRecordsCount: number;
  todaySeconds: number;
  onBack: () => void;
}) {
  const [weekStart] = useState(() => Date.now() - 7 * 24 * 60 * 60 * 1000);
  const weekRecords = records.filter(
    (record) => new Date(record.completedAt).getTime() >= weekStart,
  );
  const weekSeconds = weekRecords.reduce((total, record) => total + record.elapsedSeconds, 0);

  return (
    <AppScreen includeBottomInset>
      <NavHeader onBack={onBack} title="专注记录" />
      <ScrollView contentContainerStyle={styles.historyContent} showsVerticalScrollIndicator={false}>
        <View style={styles.historySummary}>
          <View style={styles.historyMetric}>
            <Text style={styles.historyMetricLabel}>今天</Text>
            <Text style={styles.historyMetricValue}>{formatFocusDuration(todaySeconds)}</Text>
            <Text style={styles.historyMetricMeta}>{todayRecordsCount} 次专注</Text>
          </View>
          <View style={styles.historyDivider} />
          <View style={styles.historyMetric}>
            <Text style={styles.historyMetricLabel}>近 7 天</Text>
            <Text style={styles.historyMetricValue}>{formatFocusDuration(weekSeconds)}</Text>
            <Text style={styles.historyMetricMeta}>{weekRecords.length} 次专注</Text>
          </View>
        </View>

        <View style={styles.historySectionHeader}>
          <Text accessibilityRole="header" style={styles.blockTitle}>
            最近专注
          </Text>
          <Text style={styles.historyCount}>{records.length} 条</Text>
        </View>

        {records.length > 0 ? (
          records.map((record, index) => (
            <View key={record.id}>
              {index > 0 ? <View style={styles.recordDivider} /> : null}
              <View style={styles.recordRow}>
                <View style={styles.recordIcon}>
                  <AppIcon color={colors.primaryStrong} name="timer-outline" size={20} />
                </View>
                <View style={styles.recordCopy}>
                  <Text numberOfLines={2} style={styles.recordTitle}>
                    {record.task?.title ?? '未关联任务'}
                  </Text>
                  <Text style={styles.recordMeta}>
                    {formatRecordDate(record.completedAt)}
                    {record.quality ? ` · ${qualityLabels[record.quality]}` : ''}
                  </Text>
                </View>
                <View style={styles.recordValueWrap}>
                  <Text style={styles.recordValue}>{formatFocusDuration(record.elapsedSeconds)}</Text>
                  <Text style={styles.recordMode}>
                    {record.mode === 'pomodoro' ? '番茄钟' : '正向计时'}
                  </Text>
                </View>
              </View>
            </View>
          ))
        ) : (
          <View style={styles.historyEmpty}>
            <View style={styles.historyEmptyIcon}>
              <AppIcon color={colors.primaryStrong} name="timer-outline" size={23} />
            </View>
            <Text style={styles.historyEmptyTitle}>还没有专注记录</Text>
            <Text style={styles.historyEmptyCopy}>完成一次专注后会显示在这里</Text>
          </View>
        )}
      </ScrollView>
    </AppScreen>
  );
}

function formatRecordDate(value: string) {
  const date = new Date(value);
  const time = `${date.getHours().toString().padStart(2, '0')}:${date
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
  if (isSameLocalDay(value)) return `今天 ${time}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

const styles = StyleSheet.create({
  pageBody: {
    flex: 1,
  },
  headerAction: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
  },
  headerDanger: {
    color: colors.danger,
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
  },
  headerPressed: {
    opacity: 0.55,
  },
  modeTabs: {
    minHeight: 56,
    paddingHorizontal: 48,
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'center',
    gap: 16,
  },
  modeTab: {
    flex: 1,
    maxWidth: 120,
    minWidth: 72,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeTabText: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },
  modeTabTextSelected: {
    color: colors.primaryStrong,
    fontWeight: '700',
  },
  modeIndicator: {
    position: 'absolute',
    bottom: 2,
    width: 28,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  readyContent: {
    paddingTop: 10,
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  ringWrap: {
    alignItems: 'center',
  },
  timerText: {
    width: '100%',
    color: colors.text,
    fontFamily,
    fontSize: 52,
    lineHeight: 64,
    fontWeight: '700',
    letterSpacing: -1.8,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  timerState: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  taskSelector: {
    minHeight: 72,
    marginTop: 20,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  taskIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
  },
  taskCopy: {
    flex: 1,
  },
  taskLabel: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 12,
    lineHeight: 17,
  },
  taskTitle: {
    marginTop: 2,
    color: colors.text,
    fontFamily,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
  },
  surfacePressed: {
    opacity: 0.62,
  },
  durationSection: {
    marginTop: 24,
  },
  blockTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '700',
  },
  durationOptions: {
    height: 72,
    marginTop: 8,
    flexDirection: 'row',
  },
  durationSlot: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  durationDivider: {
    width: StyleSheet.hairlineWidth,
    height: 25,
    backgroundColor: colors.border,
  },
  durationOption: {
    flex: 1,
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  durationText: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },
  durationTextSelected: {
    color: colors.text,
    fontWeight: '700',
  },
  durationDot: {
    width: 7,
    height: 7,
    marginTop: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  savedNotice: {
    minHeight: 46,
    marginTop: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  savedNoticeText: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  actionDock: {
    paddingTop: 10,
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: colors.background,
  },
  todaySummary: {
    marginBottom: 10,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  button: {
    minHeight: 54,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  buttonNeutral: {
    backgroundColor: colors.surface,
  },
  buttonDanger: {
    backgroundColor: colors.surface,
  },
  buttonDisabled: {
    opacity: 0.42,
  },
  buttonPressed: {
    opacity: 0.76,
    transform: [{ scale: 0.99 }],
  },
  buttonText: {
    color: colors.background,
    fontFamily,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '700',
  },
  buttonTextNeutral: {
    color: colors.text,
  },
  buttonTextDanger: {
    color: colors.danger,
  },
  activeContent: {
    flexGrow: 1,
    paddingTop: 18,
    paddingHorizontal: 20,
    paddingBottom: 20,
    alignItems: 'center',
  },
  activeMeta: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  activeTaskTitle: {
    maxWidth: 320,
    marginTop: 7,
    color: colors.text,
    fontFamily,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '700',
    textAlign: 'center',
  },
  activeRingWrap: {
    marginTop: 26,
  },
  liveStateLine: {
    marginTop: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  pausedDot: {
    backgroundColor: colors.textTertiary,
  },
  thoughtRow: {
    width: '100%',
    minHeight: 70,
    marginTop: 28,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  thoughtIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
  },
  thoughtCopy: {
    flex: 1,
  },
  thoughtTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  thoughtMeta: {
    marginTop: 3,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 12,
    lineHeight: 17,
  },
  thoughtCount: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: radius.pill,
    overflow: 'hidden',
    color: colors.primaryStrong,
    backgroundColor: colors.primarySoft,
    fontFamily,
    fontSize: 12,
    lineHeight: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  controlRow: {
    flexDirection: 'row',
    gap: 12,
  },
  controlButton: {
    flex: 1,
  },
  completionContent: {
    flexGrow: 1,
    paddingTop: 28,
    paddingHorizontal: 24,
    paddingBottom: 24,
    alignItems: 'center',
  },
  completeIcon: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  completionTitle: {
    marginTop: 26,
    color: colors.text,
    fontFamily,
    fontSize: 24,
    lineHeight: 33,
    fontWeight: '700',
  },
  completionDuration: {
    marginTop: 6,
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '600',
  },
  completionTask: {
    maxWidth: 310,
    marginTop: 18,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  textAction: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textActionLabel: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
  },
  breakContent: {
    flexGrow: 1,
    paddingTop: 22,
    paddingHorizontal: 24,
    paddingBottom: 24,
    alignItems: 'center',
  },
  breakTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 24,
    lineHeight: 33,
    fontWeight: '700',
  },
  breakCopy: {
    marginTop: 6,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
  },
  breakRingWrap: {
    marginTop: 38,
  },
  restTimerText: {
    color: colors.textSecondary,
  },
  summaryContent: {
    paddingTop: 24,
    paddingHorizontal: 16,
    paddingBottom: 28,
  },
  summaryMark: {
    width: 56,
    height: 56,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  summaryTitle: {
    marginTop: 14,
    color: colors.text,
    fontFamily,
    fontSize: 23,
    lineHeight: 32,
    fontWeight: '700',
    textAlign: 'center',
  },
  summaryDuration: {
    marginTop: 4,
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    textAlign: 'center',
  },
  summaryTaskRow: {
    minHeight: 72,
    marginTop: 24,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  summaryTaskIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
  },
  summaryTaskTitle: {
    marginTop: 2,
    color: colors.text,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  summaryBlock: {
    marginTop: 26,
  },
  radioGroup: {
    marginTop: 8,
  },
  radioRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  radioOuter: {
    width: 21,
    height: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
  },
  radioOuterSelected: {
    borderColor: colors.primaryStrong,
  },
  radioInner: {
    width: 11,
    height: 11,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  radioLabel: {
    color: colors.text,
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
  },
  optionalLabel: {
    color: colors.textTertiary,
    fontSize: 12,
    fontWeight: '400',
  },
  qualityRow: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 10,
  },
  qualityOption: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  qualityOptionSelected: {
    backgroundColor: colors.primarySoft,
  },
  qualityText: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
  },
  qualityTextSelected: {
    color: colors.primaryStrong,
    fontWeight: '700',
  },
  summaryThoughts: {
    minHeight: 48,
    marginTop: 22,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  summaryThoughtsText: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  temporaryTaskRow: {
    minHeight: 54,
    paddingLeft: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  temporaryTaskInput: {
    flex: 1,
    minHeight: 54,
    color: colors.text,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
  },
  useTaskButton: {
    minWidth: 64,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  useTaskButtonDisabled: {
    opacity: 0.35,
  },
  useTaskButtonText: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  sheetSectionTitle: {
    marginTop: 20,
    marginBottom: 4,
    color: colors.text,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
  },
  taskSheetList: {
    maxHeight: 330,
  },
  taskSheetRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  taskListDot: {
    width: 9,
    height: 9,
    borderRadius: radius.pill,
  },
  taskSheetTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  taskSheetMeta: {
    marginTop: 3,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 12,
    lineHeight: 17,
  },
  stepper: {
    minHeight: 148,
    marginBottom: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepperButton: {
    width: 54,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  stepperButtonDisabled: {
    opacity: 0.35,
  },
  stepperValue: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 7,
  },
  stepperNumber: {
    color: colors.text,
    fontFamily,
    fontSize: 52,
    lineHeight: 64,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  stepperUnit: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
  },
  thoughtInput: {
    minHeight: 120,
    marginBottom: 16,
    padding: 14,
    borderRadius: radius.md,
    color: colors.text,
    backgroundColor: colors.surface,
    fontFamily,
    fontSize: 15,
    lineHeight: 23,
  },
  endTaskTitle: {
    marginBottom: 18,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  endActions: {
    gap: 10,
  },
  historyContent: {
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  historySummary: {
    minHeight: 132,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  historyMetric: {
    flex: 1,
    alignItems: 'center',
  },
  historyMetricLabel: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  historyMetricValue: {
    marginTop: 7,
    color: colors.text,
    fontFamily,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  historyMetricMeta: {
    marginTop: 3,
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  historyDivider: {
    width: StyleSheet.hairlineWidth,
    height: 56,
    backgroundColor: colors.border,
  },
  historySectionHeader: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  historyCount: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
  },
  recordDivider: {
    marginLeft: 54,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  recordRow: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  recordIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
  },
  recordCopy: {
    flex: 1,
  },
  recordTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  recordMeta: {
    marginTop: 4,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 12,
    lineHeight: 17,
  },
  recordValueWrap: {
    alignItems: 'flex-end',
  },
  recordValue: {
    color: colors.text,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
  },
  recordMode: {
    marginTop: 3,
    color: colors.textTertiary,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
  },
  historyEmpty: {
    minHeight: 250,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyEmptyIcon: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
  },
  historyEmptyTitle: {
    marginTop: 13,
    color: colors.text,
    fontFamily,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '700',
  },
  historyEmptyCopy: {
    marginTop: 4,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
  },
});
