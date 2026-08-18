import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AiFab } from '@/components/ui/ai-fab';
import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { PageHeader } from '@/components/ui/page-header';
import { colors, fontFamily, radius } from '@/theme/tokens';

type Tracker = {
  id: string;
  name: string;
  icon: React.ComponentProps<typeof AppIcon>['name'];
  latest: string;
  updated: string;
  trend: string;
  dueToday?: boolean;
};

const trackers: Tracker[] = [
  {
    id: 'sleep',
    name: '睡眠',
    icon: 'moon-outline',
    latest: '7小时 20分',
    updated: '今天 07:45',
    trend: '近 7 天平均 7小时 08分',
    dueToday: true,
  },
  {
    id: 'weight',
    name: '体重',
    icon: 'scale-outline',
    latest: '68.4 kg',
    updated: '昨天 08:10',
    trend: '较上周下降 0.3 kg',
  },
  {
    id: 'water',
    name: '饮水',
    icon: 'water-outline',
    latest: '1,800 ml',
    updated: '今天 16:20',
    trend: '今日目标完成 90%',
    dueToday: true,
  },
  {
    id: 'reading',
    name: '阅读',
    icon: 'book-outline',
    latest: '30 分钟',
    updated: '昨天 21:35',
    trend: '已连续打卡 6 天',
    dueToday: true,
  },
];

function TrackerIcon({ tracker }: { tracker: Tracker }) {
  return (
    <View style={styles.trackerIcon}>
      <AppIcon color={colors.primaryStrong} name={tracker.icon} size={20} />
    </View>
  );
}

export default function DataScreen() {
  const [recordedIds, setRecordedIds] = useState<Set<string>>(new Set());
  const pendingTrackers = useMemo(
    () => trackers.filter((tracker) => tracker.dueToday && !recordedIds.has(tracker.id)),
    [recordedIds],
  );
  const todayTrackerCount = trackers.filter((tracker) => tracker.dueToday).length;
  const completedToday = todayTrackerCount - pendingTrackers.length;

  return (
    <AppScreen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <PageHeader
          action={
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.manageButton, pressed && styles.pressed]}
            >
              <Text style={styles.manageText}>管理</Text>
            </Pressable>
          }
          subtitle={`今天已完成 ${completedToday}/${todayTrackerCount}`}
          title="打卡"
        />

        <View style={styles.sectionHeading}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>今日待打卡</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{pendingTrackers.length} 项</Text>
          </View>
        </View>

        {pendingTrackers.length > 0 ? (
          <View style={styles.pendingList}>
            {pendingTrackers.map((tracker) => (
              <View key={tracker.id} style={styles.pendingRow}>
                <TrackerIcon tracker={tracker} />
                <View style={styles.pendingCopy}>
                  <Text style={styles.pendingName}>{tracker.name}</Text>
                  <Text style={styles.pendingMeta}>今天还没有打卡</Text>
                </View>
                <Pressable
                  accessibilityLabel={`打卡${tracker.name}`}
                  accessibilityRole="button"
                  onPress={() =>
                    setRecordedIds((current) => new Set([...current, tracker.id]))
                  }
                  style={({ pressed }) => [styles.recordButton, pressed && styles.recordPressed]}
                >
                  <Text style={styles.recordText}>打卡</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.completedPanel}>
            <View style={styles.completedIcon}>
              <AppIcon color={colors.primaryStrong} name="checkmark" size={20} />
            </View>
            <View>
              <Text style={styles.completedTitle}>今天的打卡已完成</Text>
              <Text style={styles.completedCopy}>完成结果会立即更新下方趋势</Text>
            </View>
          </View>
        )}

        <View style={styles.sectionHeading}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>我的打卡</Text>
          <Text style={styles.sectionMeta}>{trackers.length} 个项目</Text>
        </View>
        <View style={styles.trackerList}>
          {trackers.map((tracker) => (
            <Pressable
              accessibilityLabel={`${tracker.name}，最近值${tracker.latest}，${tracker.trend}`}
              accessibilityRole="button"
              key={tracker.id}
              style={({ pressed }) => [styles.trackerRow, pressed && styles.trackerPressed]}
            >
              <TrackerIcon tracker={tracker} />
              <View style={styles.trackerCopy}>
                <View style={styles.trackerTopLine}>
                  <Text style={styles.trackerName}>{tracker.name}</Text>
                  <Text style={styles.trackerValue}>{tracker.latest}</Text>
                </View>
                <Text style={styles.trackerTrend}>{tracker.trend}</Text>
                <Text style={styles.trackerUpdated}>{tracker.updated}</Text>
              </View>
              <AppIcon color={colors.borderStrong} name="chevron-forward" size={17} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
      <AiFab count={1} />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 112,
  },
  manageButton: {
    minWidth: 56,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  manageText: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  pressed: {
    backgroundColor: colors.primarySoft,
  },
  sectionHeading: {
    minHeight: 52,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '600',
  },
  countBadge: {
    minWidth: 40,
    height: 24,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  countText: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },
  sectionMeta: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  pendingList: {
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  pendingRow: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  trackerIcon: {
    width: 36,
    height: 36,
    marginRight: 12,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  pendingCopy: {
    flex: 1,
  },
  pendingName: {
    color: colors.text,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  pendingMeta: {
    marginTop: 3,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
  },
  recordButton: {
    minWidth: 54,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  recordPressed: {
    backgroundColor: colors.primaryTrack,
  },
  recordText: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  completedPanel: {
    minHeight: 84,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
  },
  completedIcon: {
    width: 38,
    height: 38,
    marginRight: 12,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#D7F5E6',
  },
  completedTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  completedCopy: {
    marginTop: 3,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
  },
  trackerList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  trackerRow: {
    minHeight: 84,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  trackerPressed: {
    opacity: 0.58,
  },
  trackerCopy: {
    flex: 1,
    paddingRight: 8,
  },
  trackerTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  trackerName: {
    color: colors.text,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  trackerValue: {
    color: colors.text,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  trackerTrend: {
    marginTop: 4,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
  },
  trackerUpdated: {
    marginTop: 2,
    color: colors.textTertiary,
    fontFamily,
    fontSize: 10,
    lineHeight: 14,
  },
});
