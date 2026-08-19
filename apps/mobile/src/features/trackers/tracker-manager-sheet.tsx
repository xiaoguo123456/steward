import { errorMessage, useListTrackers, type Tracker } from '@steward/api-client';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/icon';
import { ModalSheet } from '@/components/ui/modal-sheet';
import { isBuiltin, useTrackerActions } from '@/features/trackers/use-tracker-actions';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

/**
 * 管理打卡（设计说明 13.2）。
 *
 * 归档、恢复与创建集中在这里。已归档的打卡项只在这一层渐进展开，
 * 不占用首页的分类位置——归档就是「先不记了」，它不该继续出现在日常视野里。
 */
export function TrackerManagerSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const active = useListTrackers({ status: 'active' });
  const archived = useListTrackers({ status: 'archived' });
  const actions = useTrackerActions();
  const [showArchived, setShowArchived] = useState(false);

  if (!visible) return null;

  const activeRows = active.data?.data ?? [];
  const archivedRows = archived.data?.data ?? [];
  const loading = active.isPending || archived.isPending;

  return (
    <Modal animationType="fade" onRequestClose={onClose} statusBarTranslucent transparent visible>
      <ModalSheet maxHeight="82%" onClose={onClose}>
        <View style={styles.sheet}>
          <Text accessibilityRole="header" style={styles.title}>
            管理打卡
          </Text>

          <AppButton
            icon="add-outline"
            label="新建打卡项"
            onPress={() => {
              onClose();
              router.push('/trackers/new');
            }}
          />

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <ScrollView style={styles.list}>
              {activeRows.map((tracker) => (
                <ManagerRow
                  actionLabel="归档"
                  busy={actions.busy}
                  key={tracker.id}
                  onAction={() => void actions.update(tracker, { status: 'archived' })}
                  onOpen={() => {
                    onClose();
                    router.push({ pathname: '/trackers/[id]', params: { id: tracker.id } });
                  }}
                  tracker={tracker}
                />
              ))}

              {archivedRows.length > 0 ? (
                <Pressable
                  accessibilityLabel={showArchived ? '收起已归档' : '展开已归档'}
                  accessibilityRole="button"
                  onPress={() => setShowArchived((current) => !current)}
                  style={({ pressed }) => [styles.expandRow, pressed && styles.pressed]}
                >
                  <Text style={styles.expandText}>
                    已归档 {archivedRows.length} 项
                  </Text>
                  <AppIcon
                    color={colors.textTertiary}
                    name={showArchived ? 'chevron-up' : 'chevron-down'}
                    size={17}
                  />
                </Pressable>
              ) : null}

              {showArchived
                ? archivedRows.map((tracker) => (
                    <ManagerRow
                      actionLabel="恢复"
                      busy={actions.busy}
                      key={tracker.id}
                      onAction={() => void actions.update(tracker, { status: 'active' })}
                      onOpen={() => {
                        onClose();
                        router.push({ pathname: '/trackers/[id]', params: { id: tracker.id } });
                      }}
                      tracker={tracker}
                    />
                  ))
                : null}
            </ScrollView>
          )}

          {active.isError || archived.isError ? (
            <Text style={styles.failure}>
              {errorMessage(active.error ?? archived.error, '暂时无法加载打卡项。')}
            </Text>
          ) : null}
          {actions.failure ? <Text style={styles.failure}>{actions.failure}</Text> : null}
        </View>
      </ModalSheet>
    </Modal>
  );
}

function ManagerRow({
  tracker,
  actionLabel,
  busy,
  onAction,
  onOpen,
}: {
  tracker: Tracker;
  actionLabel: string;
  busy: boolean;
  onAction: () => void;
  onOpen: () => void;
}) {
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityLabel={`打开 ${tracker.name}`}
        accessibilityRole="button"
        onPress={onOpen}
        style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}
      >
        <Text numberOfLines={1} style={styles.rowName}>
          {tracker.name}
        </Text>
        {isBuiltin(tracker) ? <Text style={styles.builtinTag}>内置</Text> : null}
        <Text style={styles.rowCount}>{tracker.record_count ?? 0}</Text>
      </Pressable>
      <Pressable
        accessibilityLabel={`${actionLabel} ${tracker.name}`}
        accessibilityRole="button"
        disabled={busy}
        onPress={onAction}
        style={({ pressed }) => [styles.rowAction, pressed && styles.pressed]}
      >
        <Text style={styles.rowActionText}>{actionLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 20,
  },
  title: {
    marginBottom: 14,
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  loading: {
    paddingVertical: 30,
    alignItems: 'center',
  },
  list: {
    marginTop: 16,
    maxHeight: 380,
  },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowMain: {
    flex: 1,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowName: {
    flex: 1,
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  builtinTag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
    color: colors.textTertiary,
    fontFamily,
    ...typography.meta,
    overflow: 'hidden',
  },
  rowCount: {
    minWidth: 24,
    textAlign: 'right',
    color: colors.textTertiary,
    fontFamily,
    ...typography.meta,
  },
  rowAction: {
    minHeight: 44,
    paddingLeft: 14,
    justifyContent: 'center',
  },
  rowActionText: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.meta,
    fontWeight: '600',
  },
  expandRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  expandText: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  failure: {
    marginTop: 12,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  pressed: {
    opacity: 0.6,
  },
});
