import {
  errorMessage,
  useGetTracker,
  useListRecords,
  type Record as TrackerRecord,
  type Tracker,
  type TrackerField,
  type TrackerSchedule,
  type UpdateTrackerRequest,
} from '@steward/api-client';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { ModalSheet } from '@/components/ui/modal-sheet';
import { NavHeader } from '@/components/ui/nav-header';
import { SectionTitle } from '@/components/ui/section-title';
import { StatePanel } from '@/components/ui/state-panel';
import { RecordSheet } from '@/features/trackers/record-sheet';
import { finalizeFields, SchemaEditor } from '@/features/trackers/schema-editor';
import {
  describeTrackerSchedule,
  TrackerSchedulePicker,
} from '@/features/trackers/tracker-schedule-picker';
import {
  fieldTypeLabels,
  isBuiltin,
  useTrackerActions,
  validateFields,
} from '@/features/trackers/use-tracker-actions';
import { formatRelativeTime } from '@/utils/format';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

/**
 * Tracker 详情（DAT-02，设计说明 13.5）。
 *
 * 最近值与变化、Record 列表、Schema 与管理入口。
 * 少于 2 条记录时不给变化结论——一条记录说明不了任何趋势。
 */
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
  const records = recordsQuery.data?.data ?? [];

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TrackerRecord | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingSchema, setEditingSchema] = useState(false);
  const [removing, setRemoving] = useState(false);

  const actions = useTrackerActions();

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
            accessibilityLabel="打卡项的更多操作"
            accessibilityRole="button"
            onPress={() => setMenuOpen(true)}
            style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
          >
            <AppIcon color={colors.text} name="ellipsis-horizontal" size={20} />
          </Pressable>
        }
        title={tracker.name}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <LatestSummary records={records} tracker={tracker} />

        <AppButton
          label="记一条"
          onPress={() => setCreating(true)}
          style={styles.primaryAction}
        />

        {!isBuiltin(tracker) ? (
          <View style={styles.frequencySummary}>
            <Text style={styles.frequencyLabel}>频率</Text>
            <Text style={styles.frequencyValue}>{describeTrackerSchedule(tracker.schedule)}</Text>
          </View>
        ) : null}

        {actions.failure ? <Text style={styles.failure}>{actions.failure}</Text> : null}

        <SectionTitle
          count={`${tracker.record_count ?? records.length} 条`}
          style={styles.section}
          title="记录"
        />
        {recordsQuery.isPending ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : records.length === 0 ? (
          <StatePanel icon="stats-chart-outline" message="还没有记录" title="暂无记录" />
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

        <SectionTitle
          count={`${tracker.fields.length} 个`}
          style={styles.section}
          title="字段"
        />
        <View style={styles.rows}>
          {tracker.fields.map((field) => (
            <View key={field.key} style={styles.schemaRow}>
              <Text style={styles.schemaLabel}>{field.label}</Text>
              <Text style={styles.schemaMeta}>
                {[fieldTypeLabels[field.type], field.unit, field.required ? '必填' : null]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
          ))}
        </View>
        {isBuiltin(tracker) ? (
          <Text style={styles.builtinHint}>
            内置打卡项的字段是固定的：改了它，之前记下的数据就读不出来了。
          </Text>
        ) : null}
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

      {menuOpen ? (
        <ManageMenu
          onArchive={async () => {
            const next = tracker.status === 'archived' ? 'active' : 'archived';
            if (await actions.update(tracker, { status: next })) {
              setMenuOpen(false);
              refresh();
            }
          }}
          onClose={() => {
            setMenuOpen(false);
            actions.dismiss();
          }}
          onDelete={() => {
            setMenuOpen(false);
            setRemoving(true);
          }}
          onEditSchema={() => {
            setMenuOpen(false);
            setEditingSchema(true);
          }}
          tracker={tracker}
        />
      ) : null}

      {editingSchema ? (
        <SchemaSheet
          busy={actions.busy}
          failure={actions.failure}
          onClose={() => {
            setEditingSchema(false);
            actions.dismiss();
          }}
          onSubmit={async (name, fields, schedule) => {
            const body: UpdateTrackerRequest = { name, fields };
            if (schedule) body.schedule = schedule;
            else if (tracker.schedule) body.clear = ['schedule'];
            if (await actions.update(tracker, body)) {
              setEditingSchema(false);
              refresh();
            }
          }}
          tracker={tracker}
        />
      ) : null}

      {removing ? (
        <DeleteConfirm
          busy={actions.busy}
          failure={actions.failure}
          onCancel={() => {
            setRemoving(false);
            actions.dismiss();
          }}
          onConfirm={async () => {
            if (await actions.remove(tracker)) router.back();
          }}
          tracker={tracker}
        />
      ) : null}
    </AppScreen>
  );
}

/**
 * 最近值与相对上一条的变化。
 *
 * 只有两条以上记录才给变化结论：一条记录能显示的只是它自己，
 * 硬凑一个「持平」出来是在编。
 */
function LatestSummary({ tracker, records }: { tracker: Tracker; records: TrackerRecord[] }) {
  const primary = tracker.fields.find((field) => field.type !== 'text');
  const latest = records[0];

  if (!latest) {
    return (
      <View style={styles.summary}>
        <Text style={styles.summaryHint}>还没有记录，记一条就能看到变化。</Text>
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
            ? ' · 至少需要 2 条记录才能看出变化'
            : ''}
      </Text>
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
  const arrow = delta > 0 ? '增加' : '减少';
  return `${arrow} ${formatNumber(Math.abs(delta))}${unit ?? ''}`;
}

function ManageMenu({
  tracker,
  onEditSchema,
  onArchive,
  onDelete,
  onClose,
}: {
  tracker: Tracker;
  onEditSchema: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const builtin = isBuiltin(tracker);
  return (
    <Modal animationType="fade" onRequestClose={onClose} statusBarTranslucent transparent visible>
      <ModalSheet onClose={onClose}>
        <View style={styles.sheet}>
          {/* 内置项的字段是固定的：改了它，历史记录就读不出来。 */}
          {builtin ? null : (
            <Pressable
              accessibilityRole="button"
              onPress={onEditSchema}
              style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}
            >
              <Text style={styles.menuText}>编辑名称、频率与字段</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={onArchive}
            style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}
          >
            <Text style={styles.menuText}>
              {tracker.status === 'archived' ? '恢复到打卡列表' : '归档，先不记了'}
            </Text>
          </Pressable>
          {builtin ? null : (
            <Pressable
              accessibilityRole="button"
              onPress={onDelete}
              style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}
            >
              <Text style={[styles.menuText, styles.menuDanger]}>删除打卡项</Text>
            </Pressable>
          )}
          {builtin ? (
            <Text style={styles.menuHint}>
              内置打卡项不能改字段或删除。不想记了就归档。
            </Text>
          ) : null}
        </View>
      </ModalSheet>
    </Modal>
  );
}

function SchemaSheet({
  tracker,
  busy,
  failure,
  onSubmit,
  onClose,
}: {
  tracker: Tracker;
  busy: boolean;
  failure: string | null;
  onSubmit: (name: string, fields: TrackerField[], schedule: TrackerSchedule | null) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(tracker.name);
  const [fields, setFields] = useState<TrackerField[]>(tracker.fields);
  const [schedule, setSchedule] = useState<TrackerSchedule | null>(tracker.schedule ?? null);
  const [invalid, setInvalid] = useState<string | null>(null);

  const submit = () => {
    const prepared = finalizeFields(fields);
    const problem = validateFields(prepared);
    setInvalid(problem);
    if (problem || !name.trim()) return;
    onSubmit(name.trim(), prepared, schedule);
  };

  return (
    <Modal animationType="fade" onRequestClose={onClose} statusBarTranslucent transparent visible>
      <ModalSheet maxHeight="88%" onClose={onClose}>
        <ScrollView contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
          <Text accessibilityRole="header" style={styles.sheetTitle}>
            编辑打卡项
          </Text>
          <TextInput
            accessibilityLabel="打卡项名称"
            maxLength={40}
            onChangeText={setName}
            placeholder="名称"
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
            value={name}
          />
          <Text style={styles.sheetSectionTitle}>频率</Text>
          <TrackerSchedulePicker onChange={setSchedule} value={schedule} />
          <Text style={styles.sheetHint}>
            删掉一个字段不会改动已经记下的数据，只是以后不再填它。
          </Text>
          <View style={styles.schemaEditor}>
            <SchemaEditor fields={fields} onChange={setFields} />
          </View>
          {invalid ? <Text style={styles.failure}>{invalid}</Text> : null}
          {failure ? <Text style={styles.failure}>{failure}</Text> : null}
          <View style={styles.actions}>
            <AppButton
              disabled={busy || !name.trim()}
              label={busy ? '正在保存…' : '保存'}
              onPress={submit}
            />
            <AppButton label="取消" onPress={onClose} variant="text" />
          </View>
        </ScrollView>
      </ModalSheet>
    </Modal>
  );
}

function DeleteConfirm({
  tracker,
  busy,
  failure,
  onConfirm,
  onCancel,
}: {
  tracker: Tracker;
  busy: boolean;
  failure: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const count = tracker.record_count ?? 0;
  return (
    <Modal animationType="fade" onRequestClose={onCancel} statusBarTranslucent transparent visible>
      <ModalSheet onClose={onCancel}>
        <View style={styles.sheet}>
          <Text accessibilityRole="header" style={styles.sheetTitle}>
            删除打卡项
          </Text>
          <Text style={styles.copy}>
            {count > 0
              ? `「${tracker.name}」下的 ${count} 条记录会一起删除。只是暂时不想记的话，归档更合适。`
              : `「${tracker.name}」还没有记录，删除后不影响任何内容。`}
          </Text>
          {failure ? <Text style={styles.failure}>{failure}</Text> : null}
          <View style={styles.actions}>
            <AppButton
              disabled={busy}
              label={busy ? '正在删除…' : '删除打卡项'}
              onPress={onConfirm}
              variant="danger"
            />
            <AppButton label="取消" onPress={onCancel} variant="text" />
          </View>
        </View>
      </ModalSheet>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 48,
  },
  headerAction: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  loading: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
  summary: {
    paddingTop: 4,
    paddingBottom: 16,
    gap: 4,
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
    marginBottom: 4,
  },
  frequencySummary: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  frequencyLabel: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  frequencyValue: {
    color: colors.text,
    fontFamily,
    ...typography.meta,
    fontWeight: '600',
  },
  section: {
    marginTop: 16,
  },
  rows: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  recordRow: {
    minHeight: 56,
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
    color: colors.textTertiary,
    fontFamily,
    ...typography.meta,
  },
  recordTime: {
    color: colors.textTertiary,
    fontFamily,
    ...typography.meta,
  },
  schemaRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  schemaLabel: {
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  schemaMeta: {
    color: colors.textTertiary,
    fontFamily,
    ...typography.meta,
  },
  builtinHint: {
    marginTop: 10,
    color: colors.textTertiary,
    fontFamily,
    ...typography.meta,
  },
  sheet: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  sheetTitle: {
    marginBottom: 12,
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  sheetSectionTitle: {
    marginTop: 16,
    marginBottom: 10,
    color: colors.text,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  sheetHint: {
    marginTop: 10,
    color: colors.textTertiary,
    fontFamily,
    ...typography.meta,
  },
  schemaEditor: {
    marginTop: 14,
  },
  copy: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
  },
  input: {
    minHeight: 46,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily,
    ...typography.input,
  },
  actions: {
    marginTop: 18,
    gap: 8,
  },
  menuRow: {
    minHeight: 52,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  menuText: {
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  menuDanger: {
    color: colors.danger,
  },
  menuHint: {
    marginTop: 12,
    color: colors.textTertiary,
    fontFamily,
    ...typography.meta,
  },
  failure: {
    marginTop: 12,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
});
