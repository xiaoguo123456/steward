import {
  errorMessage,
  useGetToday,
  useListTaskLists,
  useListTasks,
  type Project,
  type Task,
  type TaskList,
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

import { AI_FAB_TAB_BAR_INSET, AiFab } from '@/components/ui/ai-fab';
import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { PageHeader } from '@/components/ui/page-header';
import { SectionTitle } from '@/components/ui/section-title';
import { StatePanel } from '@/components/ui/state-panel';
import {
  CreateTaskListSheet,
  TaskListActionSheet,
  TaskListSectionMenu,
} from '@/features/plan/task-list-sheets';
import { TaskListIconChip } from '@/features/plan/task-list-icon';
import { ProjectScopeBar } from '@/features/projects/project-scope-bar';
import { TaskRow } from '@/features/tasks/components/task-row';
import { useToggleTaskDone } from '@/features/tasks/use-task-actions';
import { formatDateParam } from '@/utils/format';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

type ScopeKey = 'today' | 'tomorrow' | 'completed' | 'unscheduled';

type ActiveView = { type: 'scope'; key: ScopeKey } | { type: 'list'; list: TaskList } | null;

const scopeTitles: Record<ScopeKey, string> = {
  today: '今天',
  tomorrow: '明天',
  completed: '已完成',
  unscheduled: '待安排',
};

const scopeEmptyCopy: Record<ScopeKey, string> = {
  today: '今天暂时没有需要处理的任务',
  tomorrow: '明天还没有安排任务',
  completed: '完成任务后会显示在这里',
  unscheduled: '所有任务都已经安排好了',
};

export default function ListsScreen() {
  const router = useRouter();
  const [activeView, setActiveView] = useState<ActiveView>(null);
  const toggleDone = useToggleTaskDone();

  const tomorrow = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    return formatDateParam(date);
  }, []);

  // 各入口的数量都来自服务端：客户端不自行推导收录条件。
  const today = useGetToday();
  const tomorrowTasks = useListTasks({ day: tomorrow, list_kind: 'tasks', limit: 100 });
  const completedTasks = useListTasks({ status: ['done'], list_kind: 'tasks', limit: 100 });
  const unscheduledTasks = useListTasks({ unscheduled: true, list_kind: 'tasks', limit: 100 });
  const taskLists = useListTaskLists({ include_archived: true, list_kind: 'tasks' });
  const [createListVisible, setCreateListVisible] = useState(false);
  const [listMenuVisible, setListMenuVisible] = useState(false);
  const allTaskLists = useMemo(() => taskLists.data?.data ?? [], [taskLists.data?.data]);
  const activeTaskLists = useMemo(
    () => allTaskLists.filter((list) => !list.archived_at),
    [allTaskLists],
  );
  const archivedTaskLists = useMemo(
    () => allTaskLists.filter((list) => Boolean(list.archived_at)),
    [allTaskLists],
  );

  const counts = {
    today: today.data?.data.counts.total ?? 0,
    tomorrow: tomorrowTasks.data?.data.length ?? 0,
    completed: completedTasks.data?.data.length ?? 0,
    unscheduled: unscheduledTasks.data?.data.length ?? 0,
  };

  const loading =
    today.isPending ||
    tomorrowTasks.isPending ||
    completedTasks.isPending ||
    unscheduledTasks.isPending ||
    taskLists.isPending;

  const failed =
    today.isError ||
    tomorrowTasks.isError ||
    completedTasks.isError ||
    unscheduledTasks.isError ||
    taskLists.isError;

  const refetchAll = () => {
    void today.refetch();
    void tomorrowTasks.refetch();
    void completedTasks.refetch();
    void unscheduledTasks.refetch();
    void taskLists.refetch();
  };

  if (activeView) {
    return (
      <DetailView
        allLists={allTaskLists}
        onBack={() => setActiveView(null)}
        onListChanged={(change) => {
          if (change.deleted || change.list?.archived_at) {
            setActiveView(null);
          } else if (change.list) {
            setActiveView({ type: 'list', list: change.list });
          }
        }}
        onToggle={(task) => toggleDone.mutate(task)}
        tasks={detailTasks(activeView, {
          today: today.data?.data.tasks.map((item) => item.task) ?? [],
          tomorrow: tomorrowTasks.data?.data ?? [],
          completed: completedTasks.data?.data ?? [],
          unscheduled: unscheduledTasks.data?.data ?? [],
        })}
        view={activeView}
      />
    );
  }

  return (
    <AppScreen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl onRefresh={refetchAll} refreshing={today.isRefetching} />}
        showsVerticalScrollIndicator={false}
      >
        <PageHeader
          action={
            <Pressable
              accessibilityLabel="打开日历"
              accessibilityRole="button"
              onPress={() => router.push('/calendar')}
              style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
            >
              <AppIcon color={colors.text} name="calendar-outline" size={22} />
            </Pressable>
          }
          subtitle="安排接下来的时间"
          title="计划"
        />

        {failed ? (
          <StatePanel
            actionLabel="重试"
            icon="cloud-offline-outline"
            message={errorMessage(today.error ?? tomorrowTasks.error, '暂时无法加载计划。')}
            onAction={refetchAll}
            title="加载失败"
          />
        ) : loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <>
            <View style={styles.shortcutRow}>
              {(['today', 'tomorrow', 'completed'] as const).map((key) => (
                <Pressable
                  accessibilityLabel={`查看${scopeTitles[key]}，${counts[key]} 项`}
                  accessibilityRole="button"
                  key={key}
                  onPress={() => setActiveView({ type: 'scope', key })}
                  style={({ pressed }) => [styles.shortcut, pressed && styles.pressed]}
                >
                  <Text style={styles.shortcutCount}>{counts[key]}</Text>
                  <Text style={styles.shortcutLabel}>{scopeTitles[key]}</Text>
                </Pressable>
              ))}
            </View>

            <SectionTitle
              count={`${counts.unscheduled} 项`}
              style={styles.sectionTitle}
              title="待安排"
            />
            <Pressable
              accessibilityLabel={`查看待安排，${counts.unscheduled} 项`}
              accessibilityRole="button"
              onPress={() => setActiveView({ type: 'scope', key: 'unscheduled' })}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <View style={[styles.rowIcon, { backgroundColor: colors.surface }]}>
                <AppIcon color={colors.textSecondary} name="albums-outline" size={19} />
              </View>
              <Text style={styles.rowTitle}>没有日期的任务</Text>
              <Text style={styles.rowCount}>{counts.unscheduled}</Text>
              <AppIcon color={colors.borderStrong} name="chevron-forward" size={17} />
            </Pressable>

            <SectionTitle
              action={activeTaskLists.length > 1 || archivedTaskLists.length > 0 ? (
                <Pressable
                  accessibilityLabel="更多清单操作"
                  accessibilityRole="button"
                  onPress={() => setListMenuVisible(true)}
                  style={({ pressed }) => [styles.sectionAction, pressed && styles.pressed]}
                >
                  <AppIcon color={colors.textSecondary} name="ellipsis-horizontal" size={21} />
                </Pressable>
              ) : undefined}
              count={`${activeTaskLists.length} 个`}
              style={styles.sectionTitle}
              title="清单"
            />
            <View style={styles.rows}>
              {activeTaskLists.map((list) => (
                <Pressable
                  accessibilityLabel={`查看清单 ${list.name}`}
                  accessibilityRole="button"
                  key={list.id}
                  onPress={() => setActiveView({ type: 'list', list })}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                >
                  <TaskListIconChip list={list} />
                  <Text style={styles.rowTitle}>{list.name}</Text>
                  <Text style={styles.rowCount}>{list.task_count ?? 0}</Text>
                  <AppIcon color={colors.borderStrong} name="chevron-forward" size={17} />
                </Pressable>
              ))}
              <Pressable
                accessibilityLabel="新建清单"
                accessibilityRole="button"
                onPress={() => setCreateListVisible(true)}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <View style={styles.addListIcon}>
                  <AppIcon color={colors.primaryStrong} name="add-outline" size={21} />
                </View>
                <Text style={styles.addListText}>新建清单</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
      <AiFab bottomInset={AI_FAB_TAB_BAR_INSET} />
      {createListVisible ? (
        <CreateTaskListSheet
          lists={activeTaskLists}
          onClose={() => setCreateListVisible(false)}
        />
      ) : null}
      {listMenuVisible ? (
        <TaskListSectionMenu
          canReorder={activeTaskLists.length > 1}
          hasArchived={archivedTaskLists.length > 0}
          onArchived={() => {
            setListMenuVisible(false);
            router.push({ pathname: '/lists/manage', params: { focus: 'archived' } });
          }}
          onClose={() => setListMenuVisible(false)}
          onReorder={() => {
            setListMenuVisible(false);
            router.push({ pathname: '/lists/manage', params: { focus: 'active' } });
          }}
        />
      ) : null}
    </AppScreen>
  );
}

/** 详情视图：展示某个入口或清单下的任务。 */
function DetailView({
  view,
  tasks,
  allLists,
  onBack,
  onListChanged,
  onToggle,
}: {
  view: NonNullable<ActiveView>;
  tasks: Task[];
  allLists: TaskList[];
  onBack: () => void;
  onListChanged: (change: { list?: TaskList; deleted?: boolean }) => void;
  onToggle: (task: Task) => void;
}) {
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [listActionsVisible, setListActionsVisible] = useState(false);
  const title = view.type === 'list' ? view.list.name : scopeTitles[view.key];

  // 项目范围是在已加载的任务上再筛一层，不重新发请求：
  // 这些任务本来就都在手里，为一个筛选再拉一遍只会让列表闪一下。
  const visible = project ? tasks.filter((task) => task.project_id === project.id) : tasks;
  const emptyCopy = project
    ? '这个项目在当前范围内还没有任务'
    : view.type === 'list'
      ? '这里还没有任务'
      : scopeEmptyCopy[view.key];

  return (
    <AppScreen includeBottomInset>
      <NavHeader
        onBack={onBack}
        right={view.type === 'list' ? (
          <Pressable
            accessibilityLabel={`更多 ${view.list.name} 操作`}
            accessibilityRole="button"
            onPress={() => setListActionsVisible(true)}
            style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
          >
            <AppIcon color={colors.text} name="ellipsis-horizontal" size={21} />
          </Pressable>
        ) : undefined}
        title={title}
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ProjectScopeBar onSelect={setProject} selectedId={project?.id ?? null} />
        {visible.length === 0 ? (
          <StatePanel icon="checkmark-done-outline" message={emptyCopy} title="暂无内容" />
        ) : (
          visible.map((task) => (
            <TaskRow
              key={task.id}
              onOpen={() => router.push({ pathname: '/tasks/[id]', params: { id: task.id } })}
              onToggle={() => onToggle(task)}
              task={{
                id: task.id,
                title: task.title,
                list: '',
                time: task.due_date ?? '无时间',
                color: colors.textTertiary,
                priority: task.priority,
                completed: task.status === 'done',
              }}
            />
          ))
        )}
      </ScrollView>
      {view.type === 'list' && listActionsVisible ? (
        <TaskListActionSheet
          list={view.list}
          lists={allLists}
          onChanged={onListChanged}
          onClose={() => setListActionsVisible(false)}
        />
      ) : null}
    </AppScreen>
  );
}

/** 按当前视图挑选要展示的任务。清单视图在已加载的任务中按 list_id 过滤。 */
function detailTasks(
  view: NonNullable<ActiveView>,
  pools: { today: Task[]; tomorrow: Task[]; completed: Task[]; unscheduled: Task[] },
): Task[] {
  if (view.type === 'scope') {
    return pools[view.key];
  }
  const merged = [...pools.today, ...pools.tomorrow, ...pools.unscheduled];
  const seen = new Set<string>();
  return merged.filter((task) => {
    if (task.list_id !== view.list.id || seen.has(task.id)) return false;
    seen.add(task.id);
    return true;
  });
}

const styles = StyleSheet.create({
  sectionAction: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 96,
  },
  headerAction: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  pressed: {
    opacity: 0.6,
  },
  loading: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  shortcutRow: {
    marginTop: 8,
    flexDirection: 'row',
    gap: 10,
  },
  shortcut: {
    flex: 1,
    minHeight: 76,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  shortcutCount: {
    color: colors.text,
    fontFamily,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
  },
  shortcutLabel: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
  },
  sectionTitle: {
    marginTop: 10,
  },
  rows: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  row: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addListIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addListText: {
    flex: 1,
    color: colors.primaryStrong,
    fontFamily,
    ...typography.bodyStrong,
  },
  rowTitle: {
    flex: 1,
    color: colors.text,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },
  rowCount: {
    color: colors.textTertiary,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
  },
});
