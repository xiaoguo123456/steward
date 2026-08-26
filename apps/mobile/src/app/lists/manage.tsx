import {
  errorMessage,
  updateTaskList,
  useListTaskLists,
  type TaskList,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { SectionTitle } from '@/components/ui/section-title';
import { StatePanel } from '@/components/ui/state-panel';
import { changedTaskListPositions, moveTaskList } from '@/features/plan/task-list-order';
import { TaskListActionSheet } from '@/features/plan/task-list-sheets';
import { TaskListIconChip } from '@/features/plan/task-list-icon';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

const EMPTY_LISTS: TaskList[] = [];
const ROW_HEIGHT = 60;

/** 低频配置集中在独立页面；计划首屏只承担浏览与新建。 */
export default function ManageTaskListsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ focus?: string | string[] }>();
  const focus = Array.isArray(params.focus) ? params.focus[0] : params.focus;
  const queryClient = useQueryClient();
  const query = useListTaskLists({ include_archived: true, list_kind: 'tasks' });
  const allLists = query.data?.data ?? EMPTY_LISTS;
  const activeFromServer = useMemo(
    () => allLists.filter((list) => !list.archived_at),
    [allLists],
  );
  const archived = useMemo(
    () => allLists.filter((list) => Boolean(list.archived_at)),
    [allLists],
  );
  const [orderedIds, setOrderedIds] = useState<string[] | null>(null);
  const [editing, setEditing] = useState<TaskList | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [archivedOffset, setArchivedOffset] = useState<number | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const ordered = useMemo(() => {
    if (!orderedIds) return activeFromServer;
    const byId = new Map(activeFromServer.map((list) => [list.id, list]));
    const selected = orderedIds.flatMap((id) => {
      const list = byId.get(id);
      if (!list) return [];
      byId.delete(id);
      return [list];
    });
    return [...selected, ...byId.values()];
  }, [activeFromServer, orderedIds]);

  useEffect(() => {
    if (focus !== 'archived' || archivedOffset === null) return;
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: archivedOffset, animated: true }));
  }, [archivedOffset, focus]);

  const persistOrder = useCallback(async (next: TaskList[]) => {
    const changes = changedTaskListPositions(next);
    if (changes.length === 0) return;

    setSavingOrder(true);
    setFailure(null);
    try {
      await Promise.all(changes.map(({ list, position }) => updateTaskList(
        list.id,
        { position },
        { headers: { 'If-Match': String(list.version) } },
      )));
      await queryClient.invalidateQueries({ queryKey: ['/v1/task-lists'] });
      setOrderedIds(null);
    } catch (error) {
      setFailure(errorMessage(error, '顺序没能保存。'));
      await query.refetch();
      setOrderedIds(null);
    } finally {
      setSavingOrder(false);
    }
  }, [query, queryClient]);

  const move = useCallback((listId: string, targetIndex: number) => {
    if (savingOrder) return;
    const next = moveTaskList(ordered, listId, targetIndex);
    if (next === ordered) return;
    setOrderedIds(next.map((list) => list.id));
    void persistOrder(next);
  }, [ordered, persistOrder, savingOrder]);

  return (
    <AppScreen includeBottomInset>
      <NavHeader
        right={
          <Pressable
            accessibilityLabel="完成编辑"
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.doneButton, pressed && styles.pressed]}
          >
            <Text style={styles.doneText}>完成</Text>
          </Pressable>
        }
        showBack={false}
        title="编辑清单"
      />

      {query.isPending ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : query.isError ? (
        <View style={styles.content}>
          <StatePanel
            actionLabel="重试"
            icon="cloud-offline-outline"
            message={errorMessage(query.error, '暂时无法加载清单。')}
            onAction={() => void query.refetch()}
            title="加载失败"
          />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
        >
          <SectionTitle count={`${ordered.length} 个`} title="正在使用" />
          <View style={styles.rows}>
            {ordered.map((list, index) => (
              <ReorderRow
                disabled={savingOrder}
                index={index}
                key={list.id}
                list={list}
                onMenu={() => setEditing(list)}
                onMove={move}
                total={ordered.length}
              />
            ))}
          </View>
          {savingOrder ? <Text style={styles.status}>正在保存顺序…</Text> : null}
          {failure ? <Text style={styles.failure}>{failure}</Text> : null}

          {archived.length > 0 ? (
            <View
              onLayout={(event) => setArchivedOffset(event.nativeEvent.layout.y)}
              style={styles.archivedSection}
            >
              <SectionTitle count={`${archived.length} 个`} title="已归档" />
              <View style={styles.rows}>
                {archived.map((list) => (
                  <ArchivedRow key={list.id} list={list} onMenu={() => setEditing(list)} />
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>
      )}

      {editing ? (
        <TaskListActionSheet
          list={editing}
          lists={allLists}
          onChanged={() => setEditing(null)}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </AppScreen>
  );
}

function ReorderRow({
  list,
  index,
  total,
  disabled,
  onMove,
  onMenu,
}: {
  list: TaskList;
  index: number;
  total: number;
  disabled: boolean;
  onMove: (listId: string, targetIndex: number) => void;
  onMenu: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const [translateY] = useState(() => new Animated.Value(0));
  const [dragging, setDragging] = useState(false);

  const finishDrag = useCallback((distance: number) => {
    const target = Math.max(0, Math.min(index + Math.round(distance / ROW_HEIGHT), total - 1));
    Animated.timing(translateY, {
      toValue: 0,
      duration: reducedMotion ? 0 : 140,
      useNativeDriver: true,
    }).start(() => {
      setDragging(false);
      onMove(list.id, target);
    });
  }, [index, list.id, onMove, reducedMotion, total, translateY]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => !disabled && Math.abs(gesture.dy) > 3,
    onPanResponderGrant: () => setDragging(true),
    onPanResponderMove: (_, gesture) => translateY.setValue(gesture.dy),
    onPanResponderRelease: (_, gesture) => finishDrag(gesture.dy),
    onPanResponderTerminate: (_, gesture) => finishDrag(gesture.dy),
    onPanResponderTerminationRequest: () => false,
  }), [disabled, finishDrag, translateY]);

  return (
    <Animated.View
      {...panResponder.panHandlers}
      style={[
        styles.row,
        dragging && styles.draggingRow,
        { transform: [{ translateY }] },
      ]}
    >
      <View
        accessibilityActions={[
          ...(index > 0 ? [{ name: 'moveUp', label: '上移' }] : []),
          ...(index < total - 1 ? [{ name: 'moveDown', label: '下移' }] : []),
        ]}
        accessibilityLabel={`调整 ${list.name} 的顺序`}
        accessibilityRole="adjustable"
        accessibilityValue={{ text: `第 ${index + 1} 项，共 ${total} 项` }}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'moveUp') onMove(list.id, index - 1);
          if (event.nativeEvent.actionName === 'moveDown') onMove(list.id, index + 1);
        }}
        style={styles.rowIdentity}
      >
        <TaskListIconChip list={list} size={34} />
        <Text numberOfLines={1} style={styles.rowName}>{list.name}</Text>
      </View>
      <Text style={styles.rowCount}>{list.task_count ?? 0}</Text>
      <MoreButton label={`编辑 ${list.name}`} onPress={onMenu} />
    </Animated.View>
  );
}

function ArchivedRow({ list, onMenu }: { list: TaskList; onMenu: () => void }) {
  return (
    <View style={styles.row}>
      <TaskListIconChip list={list} muted size={38} />
      <Text numberOfLines={1} style={styles.rowName}>{list.name}</Text>
      <Text style={styles.rowCount}>{list.task_count ?? 0}</Text>
      <MoreButton label={`操作 ${list.name}`} onPress={onMenu} />
    </View>
  );
}

function MoreButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
    >
      <AppIcon color={colors.textSecondary} name="ellipsis-horizontal" size={20} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 44,
  },
  doneButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  doneText: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  loading: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  rows: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  row: {
    minHeight: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  draggingRow: {
    zIndex: 2,
    opacity: 0.9,
    backgroundColor: colors.surfaceRaised,
  },
  rowIdentity: {
    flex: 1,
    minWidth: 0,
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
  rowCount: {
    minWidth: 22,
    color: colors.textTertiary,
    fontFamily,
    ...typography.meta,
    textAlign: 'right',
  },
  moreButton: {
    width: 40,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  archivedSection: {
    marginTop: 14,
  },
  status: {
    marginTop: 10,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
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
