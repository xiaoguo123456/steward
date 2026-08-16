import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import {
  WorkoutIconTile,
  WorkoutSectionTitle,
} from '@/features/workouts/components/workout-ui';
import {
  recentWorkouts,
  workoutAccent,
  workoutModes,
  type WorkoutHistoryItem,
} from '@/features/workouts/mock-data';
import type { WorkoutMode } from '@/features/workouts/model';
import { colors, fontFamily, radius } from '@/theme/tokens';

type HistoryFilter = 'all' | WorkoutMode;

const filters: { id: HistoryFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  ...workoutModes.map((mode) => ({ id: mode.id, label: mode.label })),
];

export default function WorkoutHistoryScreen() {
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(recentWorkouts[0].id);
  const visibleItems = useMemo(
    () => recentWorkouts.filter((item) => filter === 'all' || item.mode === filter),
    [filter],
  );

  return (
    <AppScreen backgroundColor={workoutAccent.background} includeBottomInset>
      <NavHeader title="运动记录" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.monthSummary}>
          <View style={styles.monthTitleRow}>
            <View>
              <Text style={styles.monthLabel}>本月运动</Text>
              <Text style={styles.monthValue}>8 次</Text>
            </View>
            <View style={styles.monthBadge}>
              <AppIcon color={colors.primaryStrong} name="trending-up-outline" size={18} />
              <Text style={styles.monthBadgeText}>比上月多 2 次</Text>
            </View>
          </View>
          <View style={styles.monthStats}>
            <HistoryStat label="累计时长" value="3 小时 42 分" />
            <View style={styles.statDivider} />
            <HistoryStat label="户外里程" value="32.6 km" />
            <View style={styles.statDivider} />
            <HistoryStat label="坚持周数" value="3 周" />
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.filterContent}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {filters.map((item) => {
            const selected = item.id === filter;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={item.id}
                onPress={() => {
                  setFilter(item.id);
                  setExpandedId(null);
                }}
                style={({ pressed }) => [
                  styles.filterItem,
                  selected && styles.filterItemSelected,
                  pressed && styles.filterItemPressed,
                ]}
              >
                <Text style={[styles.filterLabel, selected && styles.filterLabelSelected]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <WorkoutSectionTitle aside={`${visibleItems.length} 条`} title="最近记录" />
        <View style={styles.historyList}>
          {visibleItems.map((item) => (
            <HistoryRow
              expanded={expandedId === item.id}
              item={item}
              key={item.id}
              onPress={() => setExpandedId((current) => (current === item.id ? null : item.id))}
            />
          ))}
        </View>

        {visibleItems.length === 0 ? (
          <View style={styles.emptyState}>
            <AppIcon color={colors.borderStrong} name="footsteps-outline" size={32} />
            <Text style={styles.emptyTitle}>还没有这类运动记录</Text>
            <Text style={styles.emptyCopy}>完成一次运动并确认保存后，会出现在这里。</Text>
          </View>
        ) : null}
      </ScrollView>
    </AppScreen>
  );
}

function HistoryStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.historyStat}>
      <Text style={styles.historyStatValue}>{value}</Text>
      <Text style={styles.historyStatLabel}>{label}</Text>
    </View>
  );
}

function HistoryRow({
  item,
  expanded,
  onPress,
}: {
  item: WorkoutHistoryItem;
  expanded: boolean;
  onPress: () => void;
}) {
  const definition = workoutModes.find((mode) => mode.id === item.mode) ?? workoutModes[0];
  return (
    <Pressable
      accessibilityLabel={`${item.title}，${item.date}，${item.primary}`}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={({ pressed }) => [styles.historyRow, pressed && styles.historyRowPressed]}
    >
      <View style={styles.historyMain}>
        <WorkoutIconTile mode={definition.id} size={42} />
        <View style={styles.historyCopy}>
          <Text style={styles.historyTitle}>{item.title}</Text>
          <Text style={styles.historyDate}>{item.date}</Text>
        </View>
        <View style={styles.historyNumbers}>
          <Text style={styles.historyPrimary}>{item.primary}</Text>
          <Text style={styles.historyDuration}>{item.duration}</Text>
        </View>
        <AppIcon
          color={colors.borderStrong}
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={17}
        />
      </View>
      {expanded ? (
        <View style={styles.expandedDetail}>
          <View style={styles.expandedItem}>
            <Text style={styles.expandedLabel}>本次表现</Text>
            <Text style={styles.expandedValue}>{item.secondary}</Text>
          </View>
          <View style={styles.expandedItem}>
            <Text style={styles.expandedLabel}>运动感受</Text>
            <Text style={styles.expandedValue}>刚刚好</Text>
          </View>
          <Text style={styles.previewHint}>当前为本地预览记录</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 32,
  },
  monthSummary: {
    padding: 16,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  },
  monthTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  monthLabel: {
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
  },
  monthValue: {
    marginTop: 4,
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 29,
    lineHeight: 36,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  monthBadge: {
    minHeight: 38,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  monthBadgeText: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  monthStats: {
    minHeight: 74,
    marginTop: 14,
    paddingTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: workoutAccent.hairline,
  },
  historyStat: {
    flex: 1,
    alignItems: 'center',
  },
  historyStatValue: {
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  historyStatLabel: {
    marginTop: 4,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    height: 32,
    backgroundColor: workoutAccent.hairline,
  },
  filterContent: {
    paddingVertical: 18,
    gap: 8,
  },
  filterItem: {
    minHeight: 40,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  filterItemSelected: {
    backgroundColor: colors.primary,
  },
  filterItemPressed: {
    opacity: 0.62,
  },
  filterLabel: {
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
  filterLabelSelected: {
    color: colors.background,
  },
  historyList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: workoutAccent.hairline,
  },
  historyRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: workoutAccent.hairline,
  },
  historyRowPressed: {
    opacity: 0.62,
  },
  historyMain: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  historyCopy: {
    flex: 1,
    minWidth: 0,
  },
  historyTitle: {
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  historyDate: {
    marginTop: 3,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
  },
  historyNumbers: {
    alignItems: 'flex-end',
  },
  historyPrimary: {
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  historyDuration: {
    marginTop: 3,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
    fontVariant: ['tabular-nums'],
  },
  expandedDetail: {
    marginBottom: 12,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  expandedItem: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  expandedLabel: {
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  expandedValue: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  previewHint: {
    marginTop: 6,
    paddingTop: 8,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.primaryTrack,
  },
  emptyState: {
    minHeight: 210,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    marginTop: 12,
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '600',
  },
  emptyCopy: {
    marginTop: 5,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
});
