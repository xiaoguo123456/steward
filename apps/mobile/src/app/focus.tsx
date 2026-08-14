import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { colors, fontFamily, radius } from '@/theme/tokens';

type FocusMode = 'pomodoro' | 'stopwatch';

export default function FocusScreen() {
  const [mode, setMode] = useState<FocusMode>('pomodoro');
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(25 * 60);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setSeconds((value) => {
        if (mode === 'stopwatch') return value + 1;
        if (value <= 1) {
          setRunning(false);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [mode, running]);

  const displayTime = useMemo(() => {
    const minutes = Math.floor(seconds / 60)
      .toString()
      .padStart(2, '0');
    const remainingSeconds = (seconds % 60).toString().padStart(2, '0');
    return `${minutes}:${remainingSeconds}`;
  }, [seconds]);

  const changeMode = (nextMode: FocusMode) => {
    setMode(nextMode);
    setRunning(false);
    setSeconds(nextMode === 'pomodoro' ? 25 * 60 : 0);
  };

  const reset = () => {
    setRunning(false);
    setSeconds(mode === 'pomodoro' ? 25 * 60 : 0);
  };

  return (
    <AppScreen includeBottomInset>
      <NavHeader
        right={
          <Pressable hitSlop={12} onPress={reset}>
            <AppIcon name="ellipsis-horizontal" size={22} />
          </Pressable>
        }
        title="专注"
      />
      <View style={styles.content}>
        <View style={styles.segment}>
          <Pressable
            onPress={() => changeMode('pomodoro')}
            style={[styles.segmentItem, mode === 'pomodoro' && styles.segmentSelected]}
          >
            <Text style={[styles.segmentText, mode === 'pomodoro' && styles.segmentTextSelected]}>
              番茄钟
            </Text>
          </Pressable>
          <Pressable
            onPress={() => changeMode('stopwatch')}
            style={[styles.segmentItem, mode === 'stopwatch' && styles.segmentSelected]}
          >
            <Text style={[styles.segmentText, mode === 'stopwatch' && styles.segmentTextSelected]}>
              正计时
            </Text>
          </Pressable>
        </View>

        <View style={styles.timerArea}>
          <Text style={styles.timer}>{displayTime}</Text>
        </View>

        <Pressable
          onPress={() => setRunning((value) => !value)}
          style={({ pressed }) => [styles.startButton, pressed && styles.startPressed]}
        >
          <Text style={styles.startText}>{running ? '暂停专注' : '开始专注'}</Text>
        </Pressable>

        <View style={styles.stats}>
          <Text style={styles.statMuted}>今日专注 2h 05m</Text>
          <Text style={styles.statPrimary}>完成 4 个番茄</Text>
        </View>
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  segment: {
    height: 40,
    padding: 4,
    flexDirection: 'row',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  segmentItem: {
    flex: 1,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentSelected: {
    backgroundColor: colors.primary,
  },
  segmentText: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 14,
    fontWeight: '500',
  },
  segmentTextSelected: {
    color: colors.background,
  },
  timerArea: {
    flex: 1,
    minHeight: 250,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timer: {
    color: colors.text,
    fontFamily,
    fontSize: 49,
    lineHeight: 62,
    fontWeight: '700',
    letterSpacing: -1.4,
  },
  startButton: {
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  startPressed: {
    opacity: 0.84,
  },
  startText: {
    color: colors.background,
    fontFamily,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '600',
  },
  stats: {
    marginTop: 27,
    marginBottom: 128,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statMuted: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 13,
  },
  statPrimary: {
    color: colors.primary,
    fontFamily,
    fontSize: 13,
  },
});
