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
  color: string;
  soft: string;
  latest: string;
  updated: string;
  trend: string;
  bars: number[];
  dueToday?: boolean;
};

const trackers: Tracker[] = [
  {
    id: 'sleep',
    name: '睡眠',
    icon: 'moon-outline',
    color: '#6D5B95',
    soft: '#F0EDF7',
    latest: '7小时 20分',
    updated: '今天 07:45',
    trend: '近 7 天平均 7小时 08分',
    bars: [18, 24, 20, 28, 22, 25, 27],
    dueToday: true,
  },
  {
    id: 'weight',
    name: '体重',
    icon: 'scale-outline',
    color: colors.primaryStrong,
    soft: colors.primarySoft,
    latest: '68.4 kg',
    updated: '昨天 08:10',
    trend: '较上周下降 0.3 kg',
    bars: [27, 26, 25, 25, 24, 23, 22],
    dueToday: true,
  },
  {
    id: 'water',
    name: '饮水',
    icon: 'water-outline',
    color: '#3978B8',
    soft: '#EAF4FF',
    latest: '1,800 ml',
    updated: '今天 16:20',
    trend: '今日目标完成 90%',
    bars: [15, 21, 18, 25, 23, 27, 26],
  },
];

function TrackerIcon({ tracker }: { tracker: Tracker }) {
  return (
    <View style={[styles.trackerIcon, { backgroundColor: tracker.soft }]}>
      <AppIcon color={tracker.color} name={tracker.icon} size={20} />
    </View>
  );
}

export default function DataScreen() {
  const [recordedIds, setRecordedIds] = useState<Set<string>>(new Set());
  const pendingTrackers = useMemo(
    () => trackers.filter((tracker) => tracker.dueToday && !recordedIds.has(tracker.id)),
    [recordedIds],
  );
  const completedToday = trackers.filter((tracker) => tracker.dueToday).length - pendingTrackers.length;

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
          subtitle={`今天已完成 ${completedToday}/2`}
          title="数据"
        />

        <View style={styles.sectionHeading}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>今日待记录</Text>
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
                  <Text style={styles.pendingMeta}>今天还没有记录</Text>
                </View>
                <Pressable
                  accessibilityLabel={`记录${tracker.name}`}
                  accessibilityRole="button"
                  onPress={() =>
                    setRecordedIds((current) => new Set([...current, tracker.id]))
                  }
                  style={({ pressed }) => [styles.recordButton, pressed && styles.recordPressed]}
                >
                  <Text style={styles.recordText}>记录</Text>
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
              <Text style={styles.completedTitle}>今天的记录已完成</Text>
              <Text style={styles.completedCopy}>新的记录会立即更新下方最近值</Text>
            </View>
          </View>
        )}

        <View style={styles.sectionHeading}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>我的记录</Text>
          <Text style={styles.sectionMeta}>{trackers.length} 个记录项目</Text>
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
                <View style={styles.trackerBottomLine}>
                  <View>
                    <Text style={styles.trackerTrend}>{tracker.trend}</Text>
                    <Text style={styles.trackerUpdated}>{tracker.updated}</Text>
                  </View>
                  <View accessible={false} style={styles.sparkBars}>
                    {tracker.bars.map((height, index) => (
                      <View
                        key={`${tracker.id}-${index}`}
                        style={[
                          styles.sparkBar,
                          { height, backgroundColor: tracker.color },
                        ]}
                      />
                    ))}
                  </View>
                </View>
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
    minHeight: 88,
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
  trackerBottomLine: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  trackerTrend: {
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
  sparkBars: {
    height: 30,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
  },
  sparkBar: {
    width: 3,
    borderRadius: radius.pill,
    opacity: 0.65,
  },
});
