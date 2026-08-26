import {
  createTaskList,
  deleteTaskList,
  errorMessage,
  updateTaskList,
  type TaskList,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ComponentProps } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/icon';
import { ModalSheet } from '@/components/ui/modal-sheet';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

type TaskListChange = {
  list?: TaskList;
  deleted?: boolean;
};

/** 新建是计划页里的高频动作，因此使用单一目的的轻量面板。 */
export function CreateTaskListSheet({
  onClose,
}: {
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async () => {
    const value = name.trim();
    if (!value || busy) return;

    setBusy(true);
    setFailure(null);
    try {
      await createTaskList({ name: value, list_kind: 'tasks' });
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
          <TextInput
            accessibilityLabel="清单名称"
            autoFocus
            maxLength={30}
            onChangeText={setName}
            onSubmitEditing={() => void submit()}
            placeholder="清单名称"
            placeholderTextColor={colors.textSecondary}
            returnKeyType="done"
            style={styles.input}
            value={name}
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

/** 清单分组只保留低频的排序与归档入口。 */
export function TaskListSectionMenu({
  canReorder,
  hasArchived,
  onClose,
  onReorder,
  onArchived,
}: {
  canReorder: boolean;
  hasArchived: boolean;
  onClose: () => void;
  onReorder: () => void;
  onArchived: () => void;
}) {
  return (
    <Modal animationType="fade" onRequestClose={onClose} statusBarTranslucent transparent visible>
      <ModalSheet minHeight={0} onClose={onClose}>
        <View style={styles.menuSheet}>
          <SheetHeader onClose={onClose} title="清单" />
          {canReorder ? (
            <MenuRow icon="reorder-three-outline" label="调整顺序" onPress={onReorder} />
          ) : null}
          {hasArchived ? (
            <MenuRow icon="archive-outline" label="已归档清单" onPress={onArchived} />
          ) : null}
        </View>
      </ModalSheet>
    </Modal>
  );
}

/** 单个清单的改名、归档与删除跟随清单本身，不再混入分组管理。 */
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
  const [mode, setMode] = useState<'menu' | 'rename' | 'delete'>('menu');
  const [name, setName] = useState(list.name);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const update = async (
    body: Parameters<typeof updateTaskList>[1],
    fallback: string,
  ) => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const response = await updateTaskList(list.id, body, {
        headers: { 'If-Match': String(list.version) },
      });
      await queryClient.invalidateQueries();
      onChanged({ list: response.data });
      onClose();
    } catch (error) {
      setFailure(errorMessage(error, fallback));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (moveTo: string) => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await deleteTaskList(list.id, { move_tasks_to_list_id: moveTo });
      await queryClient.invalidateQueries();
      onChanged({ deleted: true });
      onClose();
    } catch (error) {
      setFailure(errorMessage(error, '删除没能完成。'));
    } finally {
      setBusy(false);
    }
  };

  const activeCount = lists.filter((item) => !item.archived_at && item.id !== list.id).length;
  const archived = Boolean(list.archived_at);

  return (
    <Modal animationType="fade" onRequestClose={onClose} statusBarTranslucent transparent visible>
      <ModalSheet minHeight={0} onClose={onClose}>
        <View style={styles.menuSheet}>
          {mode === 'rename' ? (
            <>
              <SheetHeader onClose={onClose} title="重命名清单" />
              <View style={styles.formBody}>
                <TextInput
                  accessibilityLabel="清单新名称"
                  autoFocus
                  maxLength={30}
                  onChangeText={setName}
                  onSubmitEditing={() => void update({ name: name.trim() }, '改名没能保存。')}
                  placeholder="清单名称"
                  placeholderTextColor={colors.textSecondary}
                  returnKeyType="done"
                  style={styles.input}
                  value={name}
                />
                {failure ? <Text style={styles.failure}>{failure}</Text> : null}
                <AppButton
                  disabled={!name.trim() || name.trim() === list.name || busy}
                  label={busy ? '正在保存…' : '保存'}
                  onPress={() => void update({ name: name.trim() }, '改名没能保存。')}
                  style={styles.primaryAction}
                />
              </View>
            </>
          ) : mode === 'delete' ? (
            <>
              <SheetHeader onClose={onClose} title="删除清单" />
              <RemoveConfirm
                busy={busy}
                failure={failure}
                lists={lists}
                onConfirm={(moveTo) => void remove(moveTo)}
                target={list}
              />
            </>
          ) : (
            <>
              <SheetHeader onClose={onClose} title={list.name} />
              <MenuRow icon="create-outline" label="重命名" onPress={() => setMode('rename')} />
              {list.is_default ? null : (
                <MenuRow
                  disabled={busy}
                  icon={archived ? 'refresh-outline' : 'archive-outline'}
                  label={archived ? '恢复清单' : '归档清单'}
                  onPress={() => void update(
                    archived ? { archived: false, position: activeCount } : { archived: true },
                    archived ? '清单没能恢复。' : '清单没能归档。',
                  )}
                />
              )}
              {list.is_default ? null : (
                <MenuRow
                  danger
                  icon="trash-outline"
                  label="删除清单"
                  onPress={() => setMode('delete')}
                />
              )}
              {failure ? <Text style={[styles.failure, styles.menuFailure]}>{failure}</Text> : null}
            </>
          )}
        </View>
      </ModalSheet>
    </Modal>
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

function MenuRow({
  icon,
  label,
  onPress,
  danger = false,
  disabled = false,
}: {
  icon: ComponentProps<typeof AppIcon>['name'];
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}
    >
      <AppIcon color={danger ? colors.danger : colors.textSecondary} name={icon} size={20} />
      <Text style={[styles.menuText, danger && styles.menuDanger]}>{label}</Text>
      <AppIcon color={colors.borderStrong} name="chevron-forward" size={17} />
    </Pressable>
  );
}

function RemoveConfirm({
  target,
  lists,
  busy,
  failure,
  onConfirm,
}: {
  target: TaskList;
  lists: TaskList[];
  busy: boolean;
  failure: string | null;
  onConfirm: (moveTo: string) => void;
}) {
  const targets = lists.filter((list) => list.id !== target.id && !list.archived_at);
  const [moveTo, setMoveTo] = useState(
    targets.find((list) => list.is_default)?.id ?? targets[0]?.id ?? '',
  );

  return (
    <View style={styles.formBody}>
      <Text style={styles.confirmCopy}>清单中的任务将移到：</Text>
      <ScrollView style={styles.moveList}>
        {targets.map((list) => (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: moveTo === list.id }}
            key={list.id}
            onPress={() => setMoveTo(list.id)}
            style={({ pressed }) => [styles.moveRow, pressed && styles.pressed]}
          >
            <AppIcon
              color={moveTo === list.id ? colors.primaryStrong : colors.borderStrong}
              name={moveTo === list.id ? 'radio-button-on' : 'radio-button-off'}
              size={20}
            />
            <Text style={styles.moveName}>{list.name}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {failure ? <Text style={styles.failure}>{failure}</Text> : null}
      <AppButton
        disabled={busy || !moveTo}
        label={busy ? '正在删除…' : '删除清单'}
        onPress={() => onConfirm(moveTo)}
        style={styles.primaryAction}
        variant="danger"
      />
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
  input: {
    minHeight: 50,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily,
    ...typography.input,
  },
  primaryAction: {
    marginTop: 14,
  },
  menuRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  menuText: {
    flex: 1,
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  menuDanger: {
    color: colors.danger,
  },
  confirmCopy: {
    marginBottom: 8,
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
  },
  moveList: {
    maxHeight: 220,
  },
  moveRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  moveName: {
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  failure: {
    marginTop: 10,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  menuFailure: {
    marginBottom: 8,
  },
  pressed: {
    opacity: 0.6,
  },
});
