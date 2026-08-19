import {
  createRecord,
  errorMessage,
  useListRecords,
  useListTrackers,
  type Record as TrackerRecord,
  type Tracker,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AiFab } from '@/components/ui/ai-fab';
import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { ModalSheet } from '@/components/ui/modal-sheet';
import { PageHeader } from '@/components/ui/page-header';
import { SectionTitle } from '@/components/ui/section-title';
import { StatePanel } from '@/components/ui/state-panel';
import { formatRelativeTime } from '@/utils/format';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

export default function DataScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [activeTracker, setActiveTracker] = useState<Tracker | null>(null);

  const trackersQuery = useListTrackers({ status: 'active' });
  const recordsQuery = useListRecords({ limit: 20 });

  const trackers = useMemo(() => trackersQuery.data?.data ?? [], [trackersQuery.data]);
  const records = recordsQuery.data?.data ?? [];

  // 今天还没有记录的 Tracker：用最近记录时间与当天比较，不做任何本地状态推断。
  const pending = useMemo(
    () => trackers.filter((tracker) => !isRecordedToday(tracker)),
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
        <PageHeader subtitle="记录你在意的数据" title="打卡" />

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
            message="还没有打卡项。说一句“今天体重 68 公斤”，AI 会帮你建立记录项。"
            onAction={() => router.push('/capture/new')}
            title="还没有打卡项"
          />
        ) : (
          <>
            <SectionTitle count={`${pending.length} 项`} title="今日待打卡" />
            {pending.length === 0 ? (
              <View style={styles.allDone}>
                <AppIcon color={colors.primaryStrong} name="checkmark-circle" size={20} />
                <Text style={styles.allDoneText}>今天的记录都完成了</Text>
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
                  <Text style={styles.rowMeta}>共 {tracker.record_count ?? 0} 条记录</Text>
                </View>
                <AppIcon color={colors.borderStrong} name="chevron-forward" size={17} />
              </Pressable>
            ))}

            {records.length > 0 ? (
              <>
                <SectionTitle style={styles.sectionTitle} title="最近记录" />
                {records.slice(0, 8).map((record: TrackerRecord) => (
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
          onSaved={async () => {
            setActiveTracker(null);
            await queryClient.invalidateQueries();
          }}
          tracker={activeTracker}
        />
      ) : null}

      <AiFab />
    </AppScreen>
  );
}

/** 记录录入面板：按 Tracker 的字段定义动态生成表单。 */
function RecordSheet({
  tracker,
  onClose,
  onSaved,
}: {
  tracker: Tracker;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requiredFilled = tracker.fields
    .filter((field) => field.required)
    .every((field) => (values[field.key] ?? '').trim().length > 0);

  const save = async () => {
    if (!requiredFilled || saving) return;
    setError(null);
    setSaving(true);
    try {
      await createRecord({
        tracker_id: tracker.id,
        timestamp: new Date().toISOString(),
        values: tracker.fields
          .filter((field) => (values[field.key] ?? '').trim().length > 0)
          .map((field) => {
            const raw = values[field.key].trim();
            // 数值字段只提交原始数值，单位换算由服务端负责。
            return field.type === 'text'
              ? { key: field.key, text_value: raw }
              : { key: field.key, number_value: Number(raw) };
          }),
      });
      await onSaved();
    } catch (err) {
      setError(errorMessage(err, '保存失败，请检查填写内容。'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalSheet onClose={onClose}>
      <Text style={styles.sheetTitle}>记录{tracker.name}</Text>
      {tracker.fields.map((field) => (
        <View key={field.key} style={styles.field}>
          <Text style={styles.fieldLabel}>
            {field.label}
            {field.unit ? `（${field.unit}）` : ''}
            {field.required ? ' *' : ''}
          </Text>
          <TextInput
            accessibilityLabel={field.label}
            keyboardType={field.type === 'text' ? 'default' : 'decimal-pad'}
            onChangeText={(text) => setValues((current) => ({ ...current, [field.key]: text }))}
            placeholder={field.type === 'text' ? '请输入内容' : '请输入数值'}
            placeholderTextColor={colors.textTertiary}
            style={styles.fieldInput}
            value={values[field.key] ?? ''}
          />
        </View>
      ))}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !requiredFilled || saving }}
        disabled={!requiredFilled || saving}
        onPress={() => void save()}
        style={({ pressed }) => [
          styles.saveButton,
          (!requiredFilled || saving) && styles.saveDisabled,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.saveText}>{saving ? '保存中…' : '保存记录'}</Text>
      </Pressable>
    </ModalSheet>
  );
}

/** 最近一次记录是否落在今天。 */
function isRecordedToday(tracker: Tracker): boolean {
  if (!tracker.last_record_at) return false;
  const last = new Date(tracker.last_record_at);
  const now = new Date();
  return (
    last.getFullYear() === now.getFullYear() &&
    last.getMonth() === now.getMonth() &&
    last.getDate() === now.getDate()
  );
}

const styles = StyleSheet.create({
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
