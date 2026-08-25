import {
  errorMessage,
  useListRecords,
  useListTrackers,
  type Record as TrackerRecord,
  type Tracker,
} from '@steward/api-client';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AiFab } from '@/components/ui/ai-fab';
import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { PageHeader } from '@/components/ui/page-header';
import { SectionTitle } from '@/components/ui/section-title';
import { StatePanel } from '@/components/ui/state-panel';
import { RecordSheet } from '@/features/trackers/record-sheet';
import { TrackerManagerSheet } from '@/features/trackers/tracker-manager-sheet';
import { formatRelativeTime } from '@/utils/format';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

export default function DataScreen() {
  const router = useRouter();
  const [activeTracker, setActiveTracker] = useState<Tracker | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);

  const trackersQuery = useListTrackers({ status: 'active' });
  const recordsQuery = useListRecords({ limit: 50 });

  const trackers = useMemo(
    () => (trackersQuery.data?.data ?? []).filter((tracker) => !tracker.builtin_key),
    [trackersQuery.data],
  );
  const records = useMemo(() => recordsQuery.data?.data ?? [], [recordsQuery.data]);

  const recentRecords = useMemo(() => {
    const customTrackerIds = new Set(trackers.map((tracker) => tracker.id));
    return records.filter((record) => customTrackerIds.has(record.tracker_id));
  }, [records, trackers]);

  // 到期状态由服务端按用户时区和打卡频率确定，客户端只负责展示。
  const pending = useMemo(
    () => trackers.filter((tracker) => tracker.due_today),
    [trackers],
  );

  const refetchAll = () => {
    void trackersQuery.refetch();
    void recordsQuery.refetch();
  };

  return (
    <AppScreen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl onRefresh={refetchAll} refreshing={trackersQuery.isRefetching} />
        }
        showsVerticalScrollIndicator={false}
      >
        <PageHeader
          action={
            <Pressable
              accessibilityLabel="管理打卡项"
              accessibilityRole="button"
              onPress={() => setManagerOpen(true)}
              style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
            >
              <Text style={styles.headerActionText}>管理</Text>
            </Pressable>
          }
          subtitle="记录你在意的数据"
          title="打卡"
        />

        {trackersQuery.isPending ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : trackersQuery.isError ? (
          <StatePanel
            actionLabel="重试"
            icon="cloud-offline-outline"
            message={errorMessage(trackersQuery.error, '暂时无法加载打卡项。')}
            onAction={refetchAll}
            title="加载失败"
          />
        ) : trackers.length === 0 ? (
          <StatePanel
            actionLabel="记一件事"
            icon="stats-chart-outline"
            message="还没有打卡项。说一句“今天体重 68 公斤”，AI 会帮你建立记录项；也可以自己填。"
            onAction={() => router.push('/capture/new')}
            onSecondary={() => router.push('/trackers/new')}
            secondaryLabel="自己新建"
            title="还没有打卡项"
          />
        ) : (
          <>
            <SectionTitle count={`${pending.length} 项`} title="今日待打卡" />
            {pending.length === 0 ? (
              <View style={styles.allDone}>
                <AppIcon color={colors.primaryStrong} name="checkmark-circle" size={20} />
                <Text style={styles.allDoneText}>今天没有需要打卡的项目</Text>
              </View>
            ) : (
              pending.map((tracker) => (
                <Pressable
                  accessibilityLabel={`记录${tracker.name}`}
                  accessibilityRole="button"
                  key={tracker.id}
                  onPress={() => setActiveTracker(tracker)}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                >
                  <View style={styles.trackerIcon}>
                    <AppIcon color={colors.primaryStrong} name="stats-chart-outline" size={19} />
                  </View>
                  <View style={styles.rowCopy}>
                    <Text style={styles.rowTitle}>{tracker.name}</Text>
                    <Text style={styles.rowMeta}>
                      {tracker.last_record_at
                        ? `上次 ${formatRelativeTime(tracker.last_record_at)}`
                        : '还没有记录'}
                    </Text>
                  </View>
                  <View style={styles.recordButton}>
                    <Text style={styles.recordButtonText}>记录</Text>
                  </View>
                </Pressable>
              ))
            )}

            <SectionTitle
              count={`${trackers.length} 项`}
              style={styles.sectionTitle}
              title="我的打卡"
            />
            {trackers.map((tracker) => (
              <Pressable
                accessibilityLabel={`查看${tracker.name}`}
                accessibilityRole="button"
                key={tracker.id}
                onPress={() =>
                  router.push({ pathname: '/trackers/[id]', params: { id: tracker.id } })
                }
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <View style={styles.trackerIcon}>
                  <AppIcon color={colors.primaryStrong} name="stats-chart-outline" size={19} />
                </View>
                <View style={styles.rowCopy}>
                  <Text style={styles.rowTitle}>{tracker.name}</Text>
                  <Text style={styles.rowMeta}>共 {tracker.record_count ?? 0} 条记录</Text>
                </View>
                <AppIcon color={colors.borderStrong} name="chevron-forward" size={17} />
              </Pressable>
            ))}

            {recentRecords.length > 0 ? (
              <>
                <SectionTitle style={styles.sectionTitle} title="最近记录" />
                {recentRecords.slice(0, 8).map((record: TrackerRecord) => (
                  <View key={record.id} style={styles.recentRow}>
                    <Text numberOfLines={1} style={styles.recentTitle}>
                      {record.title}
                    </Text>
                    <Text style={styles.recentTime}>{formatRelativeTime(record.timestamp)}</Text>
                  </View>
                ))}
              </>
            ) : null}
          </>
        )}
      </ScrollView>

      {activeTracker ? (
        <RecordSheet
          onClose={() => setActiveTracker(null)}
          onSaved={() => {
            setActiveTracker(null);
            refetchAll();
          }}
          tracker={activeTracker}
        />
      ) : null}

      <TrackerManagerSheet onClose={() => setManagerOpen(false)} visible={managerOpen} />

      <AiFab />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  headerAction: {
    minHeight: 44,
    paddingHorizontal: 4,
    justifyContent: 'center',
  },
  headerActionText: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.meta,
    fontWeight: '600',
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 96,
  },
  loading: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  sectionTitle: {
    marginTop: 10,
  },
  allDone: {
    minHeight: 56,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  allDoneText: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.body,
  },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pressed: {
    opacity: 0.65,
  },
  trackerIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: colors.text,
    fontFamily,
    ...typography.bodyStrong,
  },
  rowMeta: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  recordButton: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  recordButtonText: {
    color: colors.background,
    fontFamily,
    fontSize: 13,
    fontWeight: '600',
  },
  recentRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  recentTitle: {
    flex: 1,
    color: colors.text,
    fontFamily,
    ...typography.meta,
  },
  recentTime: {
    color: colors.textTertiary,
    fontFamily,
    ...typography.caption,
  },
  sheetTitle: {
    marginBottom: 12,
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  field: {
    marginBottom: 14,
  },
  fieldLabel: {
    marginBottom: 6,
    color: colors.textSecondary,
    fontFamily,
    ...typography.label,
  },
  fieldInput: {
    minHeight: 46,
    paddingHorizontal: 12,
    color: colors.text,
    fontFamily,
    ...typography.input,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  error: {
    marginBottom: 10,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  saveButton: {
    minHeight: 48,
    marginTop: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  saveDisabled: {
    backgroundColor: colors.borderStrong,
  },
  saveText: {
    color: colors.background,
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
  },
});
