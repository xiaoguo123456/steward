import {
  errorMessage,
  useGetTracker,
  useListRecords,
  type Record as TrackerRecord,
  type Tracker,
  type TrackerField,
} from '@steward/api-client';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { SectionTitle } from '@/components/ui/section-title';
import { StatePanel } from '@/components/ui/state-panel';
import { RecordSheet } from '@/features/trackers/record-sheet';
import {
  TrackerTrendChart,
  type TrendRange,
} from '@/features/trackers/trend-chart';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';
import { formatRelativeTime } from '@/utils/format';

/** Tracker 详情只解释数据；名称、频率和字段配置统一进入管理页。 */
export default function TrackerDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const trackerId = String(id ?? '');
  const query = useGetTracker(trackerId, { query: { enabled: Boolean(trackerId) } });
  const recordsQuery = useListRecords(
    { tracker_id: trackerId, limit: 50 },
    { query: { enabled: Boolean(trackerId) } },
  );
  const tracker = query.data?.data;
  const records = useMemo(
    () =>
      [...(recordsQuery.data?.data ?? [])].sort(
        (left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp),
      ),
    [recordsQuery.data],
  );
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TrackerRecord | null>(null);
  const [range, setRange] = useState<TrendRange>('week');

  if (query.isPending) {
    return (
      <AppScreen includeBottomInset>
        <NavHeader onBack={() => router.back()} title="打卡项" />
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </AppScreen>
    );
  }

  if (query.isError || !tracker) {
    return (
      <AppScreen includeBottomInset>
        <NavHeader onBack={() => router.back()} title="打卡项" />
        <View style={styles.content}>
          <StatePanel
            actionLabel="重试"
            icon="cloud-offline-outline"
            message={errorMessage(query.error, '暂时无法加载这个打卡项。')}
            onAction={() => void query.refetch()}
            title="加载失败"
          />
        </View>
      </AppScreen>
    );
  }

  const numericField = tracker.fields.find((field) => field.type !== 'text');
  const refresh = () => {
    void query.refetch();
    void recordsQuery.refetch();
  };

  return (
    <AppScreen includeBottomInset>
      <NavHeader
        onBack={() => router.back()}
        right={
          <Pressable
            accessibilityLabel="管理打卡项"
            accessibilityRole="button"
            onPress={() => router.push('/trackers/manage')}
            style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
          >
            <Text style={styles.manageText}>管理</Text>
          </Pressable>
        }
        title={tracker.name}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <LatestSummary records={records} tracker={tracker} />

        <AppButton label="记一条" onPress={() => setCreating(true)} style={styles.primaryAction} />

        {numericField ? (
          <>
            <SectionTitle
              action={<RangePicker onChange={setRange} value={range} />}
              style={styles.section}
              title="趋势"
            />
            <TrackerTrendChart field={numericField} range={range} records={records} />
          </>
        ) : null}

        <SectionTitle
          count={`${tracker.record_count ?? records.length} 条`}
          style={styles.section}
          title="记录"
        />
        {recordsQuery.isPending ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : recordsQuery.isError ? (
          <StatePanel
            actionLabel="重试"
            icon="cloud-offline-outline"
            message={errorMessage(recordsQuery.error, '暂时无法加载记录。')}
            onAction={() => void recordsQuery.refetch()}
            title="加载失败"
          />
        ) : records.length === 0 ? (
          <View style={styles.emptyRecords}>
            <Text style={styles.emptyRecordsText}>还没有记录</Text>
          </View>
        ) : (
          <View style={styles.rows}>
            {records.map((record) => (
              <Pressable
                accessibilityLabel={`编辑 ${record.title}`}
                accessibilityRole="button"
                key={record.id}
                onPress={() => setEditing(record)}
                style={({ pressed }) => [styles.recordRow, pressed && styles.pressed]}
              >
                <View style={styles.recordCopy}>
                  <Text numberOfLines={1} style={styles.recordTitle}>
                    {record.title}
                  </Text>
                  {record.note ? (
                    <Text numberOfLines={1} style={styles.recordNote}>
                      {record.note}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.recordTime}>{formatRelativeTime(record.timestamp)}</Text>
                <AppIcon color={colors.borderStrong} name="chevron-forward" size={17} />
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      {creating ? (
        <RecordSheet
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            refresh();
          }}
          tracker={tracker}
        />
      ) : null}

      {editing ? (
        <RecordSheet
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
          record={editing}
          tracker={tracker}
        />
      ) : null}
    </AppScreen>
  );
}

function LatestSummary({ tracker, records }: { tracker: Tracker; records: TrackerRecord[] }) {
  const primary = tracker.fields.find((field) => field.type !== 'text');
  const latest = records[0];

  if (!latest) {
    return (
      <View style={styles.summary}>
        <Text style={styles.summaryHint}>还没有记录</Text>
      </View>
    );
  }

  const current = primary ? numberOf(latest, primary) : null;
  const previous = primary && records[1] ? numberOf(records[1], primary) : null;

  return (
    <View style={styles.summary}>
      <Text style={styles.summaryValue}>
        {current === null ? latest.title : `${formatNumber(current)}${primary?.unit ?? ''}`}
      </Text>
      <Text style={styles.summaryMeta}>
        {formatRelativeTime(latest.timestamp)}
        {current !== null && previous !== null
          ? ` · 较上次${describeDelta(current - previous, primary?.unit)}`
          : records.length < 2
            ? ' · 再记一次可查看趋势'
            : ''}
      </Text>
    </View>
  );
}

function RangePicker({
  value,
  onChange,
}: {
  value: TrendRange;
  onChange: (value: TrendRange) => void;
}) {
  return (
    <View style={styles.rangePicker}>
      {([
        ['week', '近 7 天'],
        ['month', '近 30 天'],
      ] as const).map(([option, label]) => {
        const selected = option === value;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected }}
            key={option}
            onPress={() => onChange(option)}
            style={({ pressed }) => [
              styles.rangeButton,
              selected && styles.rangeButtonActive,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.rangeText, selected && styles.rangeTextActive]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function numberOf(record: TrackerRecord, field: TrackerField): number | null {
  const value = record.values.find((item) => item.key === field.key);
  return value?.number_value ?? null;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function describeDelta(delta: number, unit?: string | null): string {
  if (Math.abs(delta) < 0.001) return '持平';
  return `${delta > 0 ? '增加' : '减少'} ${formatNumber(Math.abs(delta))}${unit ?? ''}`;
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 48,
  },
  headerAction: {
    minWidth: 44,
    height: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  manageText: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.meta,
    fontWeight: '600',
  },
  loading: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.62,
  },
  summary: {
    paddingTop: 6,
    paddingBottom: 18,
    gap: 3,
  },
  summaryValue: {
    color: colors.text,
    fontFamily,
    fontSize: 30,
    lineHeight: 38,
    fontWeight: '700',
  },
  summaryMeta: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  summaryHint: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
  },
  primaryAction: {
    marginBottom: 2,
  },
  section: {
    marginTop: 14,
  },
  rangePicker: {
    padding: 3,
    flexDirection: 'row',
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  rangeButton: {
    minHeight: 34,
    paddingHorizontal: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  rangeButtonActive: {
    backgroundColor: colors.background,
  },
  rangeText: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.caption,
  },
  rangeTextActive: {
    color: colors.primaryStrong,
    fontWeight: '700',
  },
  rows: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  recordRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  recordCopy: {
    flex: 1,
    gap: 2,
  },
  recordTitle: {
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  recordNote: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  recordTime: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.caption,
  },
  emptyRecords: {
    minHeight: 76,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  emptyRecordsText: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
  },
});
