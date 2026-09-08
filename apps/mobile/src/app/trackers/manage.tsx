import {
  errorMessage,
  useListTrackers,
  type Tracker,
  type TrackerField,
  type TrackerSchedule,
  type UpdateTrackerRequest,
} from '@steward/api-client';
import { useRouter } from 'expo-router';
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
import { finalizeFields, SchemaEditor } from '@/features/trackers/schema-editor';
import {
  describeTrackerSchedule,
  TrackerSchedulePicker,
} from '@/features/trackers/tracker-schedule-picker';
import { isBuiltin, useTrackerActions, validateFields } from '@/features/trackers/use-tracker-actions';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

/** 管理页只承载配置操作，日常数据与趋势仍留在 Tracker 详情。 */
export default function ManageTrackersScreen() {
  const router = useRouter();
  const activeQuery = useListTrackers({ status: 'active' });
  const archivedQuery = useListTrackers({ status: 'archived' });
  const [editing, setEditing] = useState<Tracker | null>(null);

  const active = (activeQuery.data?.data ?? []).filter((tracker) => !isBuiltin(tracker));
  const archived = (archivedQuery.data?.data ?? []).filter((tracker) => !isBuiltin(tracker));
  const loading = activeQuery.isPending || archivedQuery.isPending;
  const failed = activeQuery.isError || archivedQuery.isError;

  const refresh = () => {
    void activeQuery.refetch();
    void archivedQuery.refetch();
  };

  return (
    <AppScreen includeBottomInset>
      <NavHeader
        onBack={() => router.back()}
        right={
          <Pressable
            accessibilityLabel="新建打卡"
            accessibilityRole="button"
            onPress={() => router.push('/trackers/new')}
            style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
          >
            <AppIcon color={colors.primaryStrong} name="add-outline" size={25} />
          </Pressable>
        }
        title="管理打卡"
      />

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : failed ? (
        <View style={styles.content}>
          <StatePanel
            actionLabel="重试"
            icon="cloud-offline-outline"
            message={errorMessage(
              activeQuery.error ?? archivedQuery.error,
              '暂时无法加载打卡项。',
            )}
            onAction={refresh}
            title="加载失败"
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <SectionTitle count={`${active.length} 项`} title="正在使用" />
          {active.length === 0 ? (
            <View style={styles.emptyRow}>
              <Text style={styles.emptyText}>还没有打卡项</Text>
            </View>
          ) : (
            <View style={styles.rows}>
              {active.map((tracker) => (
                <TrackerRow key={tracker.id} onPress={() => setEditing(tracker)} tracker={tracker} />
              ))}
            </View>
          )}

          <SectionTitle count={`${archived.length} 项`} style={styles.section} title="已归档" />
          {archived.length === 0 ? (
            <View style={styles.emptyRow}>
              <Text style={styles.emptyText}>没有已归档的项目</Text>
            </View>
          ) : (
            <View style={styles.rows}>
              {archived.map((tracker) => (
                <TrackerRow key={tracker.id} onPress={() => setEditing(tracker)} tracker={tracker} />
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {editing ? (
        <TrackerEditorSheet
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
          tracker={editing}
        />
      ) : null}
    </AppScreen>
  );
}

function TrackerRow({ tracker, onPress }: { tracker: Tracker; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={`编辑 ${tracker.name}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.rowIcon}>
        <AppIcon color={colors.primaryStrong} name="stats-chart-outline" size={19} />
      </View>
      <View style={styles.rowCopy}>
        <Text numberOfLines={1} style={styles.rowName}>
          {tracker.name}
        </Text>
        <Text style={styles.rowMeta}>
          {describeTrackerSchedule(tracker.schedule)} · {tracker.record_count ?? 0} 条记录
        </Text>
      </View>
      <AppIcon color={colors.borderStrong} name="chevron-forward" size={18} />
    </Pressable>
  );
}

function TrackerEditorSheet({
  tracker,
  onSaved,
  onClose,
}: {
  tracker: Tracker;
  onSaved: () => void;
  onClose: () => void;
}) {
  const actions = useTrackerActions();
  const [name, setName] = useState(tracker.name);
  const [fields, setFields] = useState<TrackerField[]>(tracker.fields);
  const [schedule, setSchedule] = useState<TrackerSchedule | null>(tracker.schedule ?? null);
  const [invalid, setInvalid] = useState<string | null>(null);

  const submit = async () => {
    const prepared = finalizeFields(fields);
    const problem = validateFields(prepared);
    setInvalid(problem);
    if (problem || !name.trim()) return;

    const body: UpdateTrackerRequest = { name: name.trim(), fields: prepared };
    if (schedule) body.schedule = schedule;
    else if (tracker.schedule) body.clear = ['schedule'];
    if (await actions.update(tracker, body)) onSaved();
  };

  const toggleArchive = async () => {
    const status = tracker.status === 'archived' ? 'active' : 'archived';
    if (await actions.update(tracker, { status })) onSaved();
  };

  return (
    <Modal animationType="fade" onRequestClose={onClose} statusBarTranslucent transparent visible>
      <ModalSheet maxHeight="90%" onClose={onClose}>
        <ScrollView contentContainerStyle={styles.editor} keyboardShouldPersistTaps="handled">
          <Text accessibilityRole="header" style={styles.editorTitle}>
            编辑打卡项
          </Text>

          <Text style={styles.label}>名称</Text>
          <TextInput
            accessibilityLabel="打卡项名称"
            maxLength={40}
            onChangeText={setName}
            placeholder="名称"
            placeholderTextColor={colors.textSecondary}
            style={styles.input}
            value={name}
          />

          <Text style={styles.label}>频率</Text>
          <TrackerSchedulePicker onChange={setSchedule} value={schedule} />

          <SectionTitle count={`${fields.length} 个`} style={styles.fieldsTitle} title="字段" />
          <SchemaEditor fields={fields} onChange={setFields} />

          {invalid ? <Text style={styles.failure}>{invalid}</Text> : null}
          {actions.failure ? <Text style={styles.failure}>{actions.failure}</Text> : null}

          <AppButton
            disabled={actions.busy || !name.trim()}
            label={actions.busy ? '正在保存…' : '保存修改'}
            onPress={() => void submit()}
            style={styles.save}
          />
          <AppButton
            disabled={actions.busy}
            label={tracker.status === 'archived' ? '恢复使用' : '归档'}
            onPress={() => void toggleArchive()}
            style={styles.archive}
            variant="secondary"
          />
        </ScrollView>
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
    paddingVertical: 48,
    alignItems: 'center',
  },
  section: {
    marginTop: 14,
  },
  rows: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  row: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowIcon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
  },
  rowCopy: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    color: colors.text,
    fontFamily,
    ...typography.bodyStrong,
  },
  rowMeta: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  emptyRow: {
    minHeight: 64,
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  emptyText: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
  },
  editor: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 24,
  },
  editorTitle: {
    color: colors.text,
    fontFamily,
    ...typography.detail,
  },
  label: {
    marginTop: 18,
    marginBottom: 8,
    color: colors.text,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  input: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily,
    ...typography.input,
  },
  fieldsTitle: {
    marginTop: 12,
  },
  save: {
    marginTop: 24,
  },
  archive: {
    marginTop: 10,
  },
  failure: {
    marginTop: 12,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  pressed: {
    opacity: 0.64,
  },
});
