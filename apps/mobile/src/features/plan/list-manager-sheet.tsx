import {
  createTaskList,
  deleteTaskList,
  errorMessage,
  updateTaskList,
  type TaskList,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { AppIcon } from '@/components/ui/icon';
import { ModalSheet } from '@/components/ui/modal-sheet';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

/**
 * 清单管理面板。新建、改名与删除共用一个入口。
 *
 * 删除一个还有任务的清单必须先说清楚那些任务去哪：服务端会返回
 * TASK_LIST_NOT_EMPTY 要求指定迁移目标，这里把选择摆在用户面前，
 * 而不是替他决定。
 */
export function ListManagerSheet({
  lists,
  visible,
  onClose,
}: {
  lists: TaskList[];
  visible: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (!visible) return null;

  const editing = lists.find((list) => list.id === editingId);
  const removing = lists.find((list) => list.id === removingId);

  const reset = () => {
    setName('');
    setEditingId(null);
    setRemovingId(null);
    setFailure(null);
  };

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setFailure(null);
    try {
      await action();
      await queryClient.invalidateQueries();
      reset();
    } catch (error) {
      setFailure(errorMessage(error, fallback));
    } finally {
      setBusy(false);
    }
  };

  const submitName = () => {
    const value = name.trim();
    if (!value) return;
    if (editing) {
      void run(
        () =>
          updateTaskList(
            editing.id,
            { name: value },
            { headers: { 'If-Match': String(editing.version) } },
          ),
        '改名没能保存。',
      );
      return;
    }
    void run(() => createTaskList({ name: value }), '清单没能创建。');
  };

  return (
    <Modal animationType="fade" onRequestClose={onClose} statusBarTranslucent transparent visible>
      <ModalSheet maxHeight="80%" onClose={onClose}>
        <View style={styles.sheet}>
          <Text accessibilityRole="header" style={styles.title}>
            {removing ? '删除清单' : editing ? '重命名清单' : '管理清单'}
          </Text>

          {removing ? (
            <RemoveConfirm
              busy={busy}
              lists={lists}
              onCancel={() => setRemovingId(null)}
              onConfirm={(moveTo) =>
                void run(() => deleteTaskList(removing.id, { move_tasks_to_list_id: moveTo ?? null }), '删除没能完成。')
              }
              target={removing}
            />
          ) : (
            <>
              <View style={styles.inputRow}>
                <TextInput
                  accessibilityLabel={editing ? '清单新名称' : '新清单名称'}
                  maxLength={30}
                  onChangeText={setName}
                  onSubmitEditing={submitName}
                  placeholder={editing ? editing.name : '新清单名称'}
                  placeholderTextColor={colors.textTertiary}
                  returnKeyType="done"
                  style={styles.input}
                  value={name}
                />
                <AppButton
                  compact
                  disabled={!name.trim() || busy}
                  label={editing ? '保存' : '新建'}
                  onPress={submitName}
                />
              </View>
              {editing ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setEditingId(null);
                    setName('');
                  }}
                  style={styles.cancelEdit}
                >
                  <Text style={styles.cancelEditText}>取消重命名</Text>
                </Pressable>
              ) : null}

              <ScrollView style={styles.list}>
                {lists.map((list) => (
                  <View key={list.id} style={styles.row}>
                    <Text numberOfLines={1} style={styles.rowName}>{list.name}</Text>
                    {list.is_default ? (
                      <Text style={styles.defaultTag}>默认</Text>
                    ) : null}
                    <Text style={styles.rowCount}>{list.task_count ?? 0}</Text>
                    <Pressable
                      accessibilityLabel={`重命名 ${list.name}`}
                      accessibilityRole="button"
                      hitSlop={8}
                      onPress={() => {
                        setEditingId(list.id);
                        setName(list.name);
                      }}
                      style={styles.rowAction}
                    >
                      <AppIcon color={colors.textSecondary} name="create-outline" size={18} />
                    </Pressable>
                    {/* 默认清单不能删：每个用户恰好要有一个。 */}
                    {list.is_default ? null : (
                      <Pressable
                        accessibilityLabel={`删除 ${list.name}`}
                        accessibilityRole="button"
                        hitSlop={8}
                        onPress={() => setRemovingId(list.id)}
                        style={styles.rowAction}
                      >
                        <AppIcon color={colors.danger} name="trash-outline" size={18} />
                      </Pressable>
                    )}
                  </View>
                ))}
              </ScrollView>
            </>
          )}

          {failure ? <Text style={styles.failure}>{failure}</Text> : null}
        </View>
      </ModalSheet>
    </Modal>
  );
}

function RemoveConfirm({
  target,
  lists,
  busy,
  onCancel,
  onConfirm,
}: {
  target: TaskList;
  lists: TaskList[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (moveTo: string | undefined) => void;
}) {
  const others = lists.filter((list) => list.id !== target.id);
  const [moveTo, setMoveTo] = useState(
    others.find((list) => list.is_default)?.id ?? others[0]?.id,
  );
  const hasTasks = (target.task_count ?? 0) > 0;

  return (
    <>
      <Text style={styles.confirmCopy}>
        {hasTasks
          ? `「${target.name}」里还有 ${target.task_count} 个未完成的任务。选一个清单把它们移过去。`
          : `「${target.name}」是空的，删除后不影响任何内容。`}
      </Text>

      {hasTasks ? (
        <ScrollView style={styles.moveList}>
          {others.map((list) => (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: moveTo === list.id }}
              key={list.id}
              onPress={() => setMoveTo(list.id)}
              style={styles.moveRow}
            >
              <AppIcon
                color={moveTo === list.id ? colors.primaryStrong : colors.borderStrong}
                name={moveTo === list.id ? 'radio-button-on' : 'radio-button-off'}
                size={19}
              />
              <Text style={styles.moveName}>{list.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.confirmActions}>
        <AppButton
          disabled={busy || (hasTasks && !moveTo)}
          label={busy ? '正在删除…' : '删除清单'}
          onPress={() => onConfirm(hasTasks ? moveTo : undefined)}
          variant="danger"
        />
        <AppButton label="取消" onPress={onCancel} variant="text" />
      </View>
    </>
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
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  input: {
    flex: 1,
    minHeight: 46,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily,
    ...typography.input,
  },
  cancelEdit: {
    marginTop: 10,
    minHeight: 36,
    justifyContent: 'center',
  },
  cancelEditText: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  list: {
    marginTop: 16,
    maxHeight: 320,
  },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowName: {
    flex: 1,
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  defaultTag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    color: colors.primaryStrong,
    fontFamily,
    ...typography.meta,
  },
  rowCount: {
    minWidth: 24,
    textAlign: 'right',
    color: colors.textTertiary,
    fontFamily,
    ...typography.meta,
  },
  rowAction: {
    width: 36,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmCopy: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
  },
  moveList: {
    marginTop: 14,
    maxHeight: 240,
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
  confirmActions: {
    marginTop: 18,
    gap: 8,
  },
  failure: {
    marginTop: 14,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
});
