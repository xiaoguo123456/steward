import {
  createTaskList,
  deleteTaskList,
  errorMessage,
  updateTaskList,
  type TaskList,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/icon';
import { ModalSheet } from '@/components/ui/modal-sheet';
import { useToast } from '@/components/ui/toast';
import {
  nextTaskListColor,
  resolveTaskListAppearance,
  suggestTaskListIcon,
  type TaskListColorToken,
  type TaskListIconId,
} from '@/features/plan/task-list-appearance';
import {
  TaskListAppearanceChip,
  TaskListAppearancePicker,
} from '@/features/plan/task-list-icon';
import { formatArchiveRetention } from '@/features/plan/task-list-policy';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

type TaskListChange = {
  list?: TaskList;
  deleted?: boolean;
};

/** 新建是计划页里的高频动作，因此使用单一目的的轻量面板。 */
export function CreateTaskListSheet({
  lists,
  onClose,
}: {
  lists: TaskList[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<TaskListIconId>('general');
  const [color, setColor] = useState<TaskListColorToken>(() => nextTaskListColor(lists));
  const [iconCustomized, setIconCustomized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const changeName = (value: string) => {
    setName(value);
    if (!iconCustomized) setIcon(suggestTaskListIcon(value));
  };

  const submit = async () => {
    const value = name.trim();
    if (!value || busy) return;

    setBusy(true);
    setFailure(null);
    try {
      await createTaskList({ name: value, list_kind: 'tasks', color, icon });
      await queryClient.invalidateQueries({ queryKey: ['/v1/task-lists'] });
      onClose();
    } catch (error) {
      setFailure(errorMessage(error, '清单没能创建。'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal animationType="fade" onRequestClose={onClose} statusBarTranslucent transparent visible>
      <ModalSheet minHeight={0} onClose={onClose}>
        <View style={styles.sheet}>
          <SheetHeader onClose={onClose} title="新建清单" />
          <TaskListIdentityFields
            color={color}
            icon={icon}
            name={name}
            onColorChange={setColor}
            onIconChange={(value) => {
              setIcon(value);
              setIconCustomized(true);
            }}
            onNameChange={changeName}
            onSubmit={() => void submit()}
          />
          {failure ? <Text style={styles.failure}>{failure}</Text> : null}
          <AppButton
            disabled={!name.trim() || busy}
            label={busy ? '正在创建…' : '创建清单'}
            onPress={() => void submit()}
            style={styles.primaryAction}
          />
        </View>
      </ModalSheet>
    </Modal>
  );
}

/** 三个点直接进入编辑；保存与归档都在同一张面板完成。 */
export function TaskListActionSheet({
  list,
  lists,
  onClose,
  onChanged,
}: {
  list: TaskList;
  lists: TaskList[];
  onClose: () => void;
  onChanged: (change: TaskListChange) => void;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const initialAppearance = resolveTaskListAppearance(list);
  const [name, setName] = useState(list.name);
  const [icon, setIcon] = useState<TaskListIconId>(initialAppearance.icon);
  const [color, setColor] = useState<TaskListColorToken>(initialAppearance.color);
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    'save' | 'archive' | 'restore' | 'delete' | null
  >(null);
  const [failure, setFailure] = useState<string | null>(null);
  const activeCount = lists.filter((item) => !item.archived_at && item.id !== list.id).length;
  const archived = Boolean(list.archived_at);
  const retention = formatArchiveRetention(list.archive_retention_seconds);

  const update = async (
    body: Parameters<typeof updateTaskList>[1],
    fallback: string,
    action: 'save' | 'archive' | 'restore',
  ) => {
    if (busy) return;
    setBusy(true);
    setPendingAction(action);
    setFailure(null);
    try {
      const response = await updateTaskList(list.id, body, {
        headers: { 'If-Match': String(list.version) },
      });
      await queryClient.invalidateQueries();
      if (action === 'archive') {
        showToast(`清单已归档，${retention}后自动删除`);
      }
      onChanged({ list: response.data });
      onClose();
    } catch (error) {
      setFailure(errorMessage(error, fallback));
    } finally {
      setBusy(false);
      setPendingAction(null);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setPendingAction('delete');
    setFailure(null);
    try {
      await deleteTaskList(list.id);
      await queryClient.invalidateQueries();
      onChanged({ deleted: true });
      onClose();
    } catch (error) {
      setFailure(errorMessage(error, '清单没能删除。'));
    } finally {
      setBusy(false);
      setPendingAction(null);
    }
  };

  const requestDelete = () => {
    Alert.alert(
      '删除清单？',
      '其中的任务会移至默认清单，删除后无法恢复。',
      [
        { text: '取消', style: 'cancel' },
        { text: '删除', style: 'destructive', onPress: () => void remove() },
      ],
    );
  };

  const identityChanged = name.trim() !== list.name
    || icon !== initialAppearance.icon
    || color !== initialAppearance.color;
  const saveIdentity = () => update(
    { name: name.trim(), icon, color },
    '清单没能保存。',
    'save',
  );
  const archiveDisabled = !archived && activeCount === 0;

  return (
    <Modal animationType="fade" onRequestClose={onClose} statusBarTranslucent transparent visible>
      <ModalSheet minHeight={0} onClose={onClose}>
        {archived ? (
          <View style={styles.menuSheet}>
            <SheetHeader onClose={onClose} title={list.name} />
            <View style={styles.archivedActions}>
              {failure ? <Text style={styles.failure}>{failure}</Text> : null}
              <AppButton
                disabled={busy}
                label={pendingAction === 'restore' ? '正在恢复…' : '恢复清单'}
                onPress={() => void update(
                  { archived: false, position: activeCount },
                  '清单没能恢复。',
                  'restore',
                )}
              />
              <AppButton
                disabled={busy}
                label={pendingAction === 'delete' ? '正在删除…' : '删除清单'}
                onPress={requestDelete}
                style={styles.archiveAction}
                variant="danger"
              />
            </View>
          </View>
        ) : (
          <View style={styles.menuSheet}>
            <SheetHeader onClose={onClose} title="编辑清单" />
            <View style={styles.formBody}>
              <TaskListIdentityFields
                color={color}
                icon={icon}
                name={name}
                onColorChange={setColor}
                onIconChange={setIcon}
                onNameChange={setName}
                onSubmit={() => void saveIdentity()}
              />
              {failure ? <Text style={styles.failure}>{failure}</Text> : null}
              <AppButton
                disabled={!name.trim() || !identityChanged || busy}
                label={pendingAction === 'save' ? '正在保存…' : '保存'}
                onPress={() => void saveIdentity()}
                style={styles.primaryAction}
              />
              <AppButton
                disabled={busy}
                label={pendingAction === 'archive' ? '正在归档…' : '归档'}
                onPress={() => {
                  if (archiveDisabled) {
                    showToast('至少保留一个正在使用的清单');
                    return;
                  }
                  void update({ archived: true }, '清单没能归档。', 'archive');
                }}
                style={styles.archiveAction}
                variant="secondary"
              />
            </View>
          </View>
        )}
      </ModalSheet>
    </Modal>
  );
}

function TaskListIdentityFields({
  name,
  icon,
  color,
  onNameChange,
  onIconChange,
  onColorChange,
  onSubmit,
}: {
  name: string;
  icon: TaskListIconId;
  color: TaskListColorToken;
  onNameChange: (name: string) => void;
  onIconChange: (icon: TaskListIconId) => void;
  onColorChange: (color: TaskListColorToken) => void;
  onSubmit: () => void;
}) {
  return (
    <>
      <View style={styles.identityRow}>
        <TaskListAppearanceChip color={color} icon={icon} size={50} />
        <TextInput
          accessibilityLabel="清单名称"
          maxLength={30}
          onChangeText={onNameChange}
          onSubmitEditing={onSubmit}
          placeholder="清单名称"
          placeholderTextColor={colors.textSecondary}
          returnKeyType="done"
          style={[styles.input, styles.nameInput]}
          value={name}
        />
      </View>
      <TaskListAppearancePicker
        color={color}
        icon={icon}
        onColorChange={onColorChange}
        onIconChange={onIconChange}
      />
    </>
  );
}

function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <View style={styles.sheetHeader}>
      <Text accessibilityRole="header" numberOfLines={1} style={styles.sheetTitle}>
        {title}
      </Text>
      <Pressable
        accessibilityLabel="关闭"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onClose}
        style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
      >
        <AppIcon color={colors.textSecondary} name="close-outline" size={23} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    paddingHorizontal: 16,
    paddingBottom: 18,
  },
  menuSheet: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  sheetHeader: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sheetTitle: {
    flex: 1,
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  formBody: {
    paddingBottom: 6,
  },
  archivedActions: {
    paddingBottom: 6,
  },
  input: {
    minHeight: 50,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily,
    ...typography.input,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  nameInput: {
    flex: 1,
  },
  primaryAction: {
    marginTop: 14,
  },
  archiveAction: {
    marginTop: 10,
  },
  failure: {
    marginTop: 10,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  pressed: {
    opacity: 0.6,
  },
});
