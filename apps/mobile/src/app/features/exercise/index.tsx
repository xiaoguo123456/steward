import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AiFab } from '@/components/ui/ai-fab';
import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon, SportModeIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import {
  WorkoutNotice,
  WorkoutSectionTitle,
} from '@/features/workouts/components/workout-ui';
import {
  workoutAccent,
  workoutModes,
} from '@/features/workouts/workout-content';
import { useWorkoutHistory } from '@/features/workouts/use-workout-history';
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
  // 运动首页只展示最近两条：它的职责是四个入口，不是历史列表。
  const visibleRecentWorkouts = useWorkoutHistory(2).items;

  const openPrepare = (mode: WorkoutMode) => router.push(getPrepareRoute(mode));
  const openHistory = () => router.push('/features/exercise/history' as Href);

  return (
    <AppScreen backgroundColor={colors.background} includeBottomInset>
      <NavHeader
        right={
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={openHistory}
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
            运动记录已保存，在“打卡”里可以查看和修改。
          </WorkoutNotice>
        ) : null}

        <View style={styles.intro}>
          <Text accessibilityRole="header" style={styles.title}>
            开始一项运动
          </Text>
          <Text style={styles.subtitle}>选择运动后，再设置本次目标</Text>
        </View>

        <View style={styles.modeGrid}>
          {workoutModes.map((mode) => (
            <Pressable
              accessibilityHint="进入运动准备页"
              accessibilityLabel={`${mode.label}，${mode.cue}`}
              accessibilityRole="button"
              key={mode.id}
              onPress={() => openPrepare(mode.id)}
              style={({ pressed }) => [styles.modeCard, pressed && styles.modeCardPressed]}
            >
              <View style={styles.modeIconArea}>
                <SportModeIcon color={colors.primaryStrong} mode={mode.id} size={40} />
              </View>
              <Text numberOfLines={1} style={styles.modeLabel}>
                {mode.label}
              </Text>
              <Text numberOfLines={1} style={styles.modeCue}>
                {mode.cue}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.recentSection}>
          <WorkoutSectionTitle aside="全部记录" onAsidePress={openHistory} title="最近运动" />
          {visibleRecentWorkouts.length > 0 ? (
            <View style={styles.recentList}>
              {visibleRecentWorkouts.map((item) => (
                <Pressable
                  accessibilityHint="查看全部运动记录"
                  accessibilityLabel={`${item.title}，${item.date}，${item.primary}`}
                  accessibilityRole="button"
                  key={item.id}
                  onPress={openHistory}
                  style={({ pressed }) => [styles.recentRow, pressed && styles.recentRowPressed]}
                >
                  <View style={styles.recentIcon}>
                    <SportModeIcon color={colors.primaryStrong} mode={item.mode} size={22} />
                  </View>
                  <View style={styles.recentCopy}>
                    <Text numberOfLines={1} style={styles.recentTitle}>
                      {item.title}
                    </Text>
                    <Text numberOfLines={1} style={styles.recentMeta}>
                      {item.date} · {item.duration}
                    </Text>
                  </View>
                  <View style={styles.recentValue}>
                    <Text numberOfLines={1} style={styles.recentValueText}>
                      {item.primary}
                    </Text>
                    <Text numberOfLines={1} style={styles.recentValueLabel}>
                      {item.secondary}
                    </Text>
                  </View>
                  <AppIcon color={workoutAccent.muted} name="chevron-forward" size={17} />
                </Pressable>
              ))}
            </View>
          ) : (
            <View style={styles.emptyState}>
              <SportModeIcon color={colors.borderStrong} mode="walking" size={29} />
              <Text style={styles.emptyTitle}>还没有运动记录</Text>
              <Text style={styles.emptyCopy}>完成一次运动并确认保存后，会出现在这里。</Text>
            </View>
          )}
        </View>
      </ScrollView>
      <AiFab />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 112,
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
  intro: {
    paddingTop: 16,
    paddingBottom: 20,
  },
  title: {
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subtitle: {
    marginTop: 5,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
  },
  modeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
  },
  modeCard: {
    width: '48.25%',
    minHeight: 142,
    paddingHorizontal: 14,
    paddingVertical: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  modeCardPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.98 }],
  },
  modeIconArea: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeLabel: {
    marginTop: 8,
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '700',
  },
  modeCue: {
    marginTop: 3,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  recentSection: {
    marginTop: 30,
  },
  recentList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: workoutAccent.hairline,
  },
  recentRow: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: workoutAccent.hairline,
  },
  recentRowPressed: {
    opacity: 0.6,
  },
  recentIcon: {
    width: 40,
    height: 40,
    flexShrink: 0,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  recentCopy: {
    minWidth: 0,
    flex: 1,
  },
  recentTitle: {
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '700',
  },
  recentMeta: {
    marginTop: 2,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 11,
    lineHeight: 17,
    fontVariant: ['tabular-nums'],
  },
  recentValue: {
    maxWidth: 98,
    alignItems: 'flex-end',
  },
  recentValueText: {
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  recentValueLabel: {
    marginTop: 2,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 10,
    lineHeight: 15,
  },
  emptyState: {
    minHeight: 158,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: workoutAccent.hairline,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: workoutAccent.hairline,
  },
  emptyTitle: {
    marginTop: 8,
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
  },
  emptyCopy: {
    marginTop: 3,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
});
