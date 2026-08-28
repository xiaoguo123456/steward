import {
  errorMessage,
  useGetToday,
  useListProjects,
  useListTaskLists,
  useListTasks,
  type Project,
  type ProjectStatus,
  type Task,
  type TaskList,
} from '@steward/api-client';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AI_FAB_TAB_BAR_INSET, AiFab } from '@/components/ui/ai-fab';
import { AppButton } from '@/components/ui/app-button';
import { AppScreen } from '@/components/ui/app-screen';
import { DateWheel } from '@/components/ui/date-wheel';
import { AppIcon } from '@/components/ui/icon';
import { ModalSheet } from '@/components/ui/modal-sheet';
import { NavHeader } from '@/components/ui/nav-header';
import { PageHeader } from '@/components/ui/page-header';
import { SectionTitle } from '@/components/ui/section-title';
import { StatePanel } from '@/components/ui/state-panel';
import { CreateTaskListSheet, TaskListActionSheet } from '@/features/plan/task-list-sheets';
import {
  buildAddToTodayRequest,
  buildSetTaskDateRequest,
} from '@/features/plan/anytime-task-actions';
import { TaskListIconChip } from '@/features/plan/task-list-icon';
import {
  getPlanTransientViewResetVersion,
  resolvePlanTransientView,
  subscribePlanTransientViewReset,
} from '@/features/plan/plan-tab-navigation';
import { ProjectScopeBar } from '@/features/projects/project-scope-bar';
import {
  filterTasksByProjectScope,
  type ProjectTaskScope,
} from '@/features/projects/project-task-scope';
import { projectFilters, projectStatusLabels } from '@/features/projects/use-projects';
import { TaskRow } from '@/features/tasks/components/task-row';
import { useToggleTaskDone, useUpdateTaskFields } from '@/features/tasks/use-task-actions';
import { formatDateParam } from '@/utils/format';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

type ScopeKey = 'today' | 'tomorrow' | 'completed' | 'unscheduled';

type ActiveView = { type: 'scope'; key: ScopeKey } | { type: 'list'; list: TaskList } | null;

const scopeTitles: Record<ScopeKey, string> = {
  today: '今天',
  tomorrow: '明天',
  completed: '已完成',
  unscheduled: '随时可做',
};

const scopeEmptyCopy: Record<Exclude<ScopeKey, 'unscheduled'>, string> = {
  today: '今天暂时没有需要处理的任务',
  tomorrow: '明天还没有安排任务',
  completed: '完成任务后会显示在这里',
};

const projectStatuses = projectFilters.map(({ key }) => key) as ProjectStatus[];

export default function ListsScreen() {
  const router = useRouter();
  const resetVersion = useSyncExternalStore(
    subscribePlanTransientViewReset,
    getPlanTransientViewResetVersion,
    getPlanTransientViewResetVersion,
  );
  const [activeViewState, setActiveViewState] = useState<{
    resetVersion: number;
    view: ActiveView;
  }>(() => ({ resetVersion, view: null }));
  const activeView = resolvePlanTransientView(
    activeViewState.view,
    activeViewState.resetVersion,
    resetVersion,
  );
  const setActiveView = useCallback((view: ActiveView) => {
    setActiveViewState({ resetVersion, view });
  }, [resetVersion]);
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

            <Pressable
              accessibilityLabel={`查看随时可做，${counts.unscheduled} 项`}
              accessibilityRole="button"
              onPress={() => setActiveView({ type: 'scope', key: 'unscheduled' })}
              style={({ pressed }) => [styles.anytimeEntry, pressed && styles.pressed]}
            >
              <View style={styles.anytimeEntryIcon}>
                <AppIcon color={colors.primaryStrong} name="time-outline" size={21} />
              </View>
              <View style={styles.anytimeEntryCopy}>
                <Text style={styles.anytimeEntryTitle}>随时可做</Text>
                <Text style={styles.anytimeEntrySubtitle}>没有固定日期的任务</Text>
              </View>
              <Text style={styles.rowCount}>{counts.unscheduled}</Text>
              <AppIcon color={colors.textTertiary} name="chevron-forward" size={17} />
            </Pressable>

            <SectionTitle
              action={activeTaskLists.length > 1 || archivedTaskLists.length > 0 ? (
                <Pressable
                  accessibilityLabel="编辑清单"
                  accessibilityRole="button"
                  onPress={() => router.push('/lists/manage')}
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
  const updateTaskFields = useUpdateTaskFields();
  const [projectScope, setProjectScope] = useState<ProjectTaskScope>({
    status: null,
    projectId: null,
  });
  const [listActionsVisible, setListActionsVisible] = useState(false);
  const [dateTask, setDateTask] = useState<Task | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => formatDateParam(new Date()));
  const title = view.type === 'list' ? view.list.name : scopeTitles[view.key];
  const isAnytime = view.type === 'scope' && view.key === 'unscheduled';
  const projectQuery = useListProjects({ status: projectStatuses, limit: 100 });
  const projects = useMemo(() => projectQuery.data?.data ?? [], [projectQuery.data?.data]);
  const listsById = useMemo(
    () => new Map(allLists.map((list) => [list.id, list])),
    [allLists],
  );
  const selectedProject = projectScope.projectId
    ? projects.find((project) => project.id === projectScope.projectId) ?? null
    : null;

  // Project 状态和具体项目都是当前清单的展示筛选，不改变 Task 的权威归属。
  const visible = filterTasksByProjectScope(tasks, projects, projectScope);
  const emptyCopy = selectedProject
    ? `项目“${selectedProject.title}”在当前清单中还没有任务`
    : projectScope.status
      ? `当前清单没有关联${projectStatusLabels[projectScope.status]}项目的任务`
    : view.type === 'list'
      ? '这里还没有任务'
      : view.key === 'unscheduled'
        ? undefined
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
        <ProjectScopeBar
          onSelectProject={(project: Project) => {
            setProjectScope({ status: project.status, projectId: project.id });
          }}
          onSelectStatus={(status) => setProjectScope({ status, projectId: null })}
          projects={projects}
          selectedProjectId={projectScope.projectId}
          selectedStatus={projectScope.status}
        />
        {visible.length === 0 ? (
          <StatePanel
            icon="checkmark-done-outline"
            message={emptyCopy}
            title="暂无内容"
          />
        ) : (
          visible.map((task) => {
            const list = listsById.get(task.list_id);
            const openTask = () => router.push({ pathname: '/tasks/[id]', params: { id: task.id } });
            return isAnytime ? (
              <AnytimeTaskRow
                busy={updateTaskFields.isPending && updateTaskFields.variables?.task.id === task.id}
                key={task.id}
                list={list}
                onAddToday={() => {
                  updateTaskFields.mutate({
                    task,
                    data: buildAddToTodayRequest(formatDateParam(new Date())),
                  });
                }}
                onOpen={openTask}
                onPickDate={() => {
                  setSelectedDate(formatDateParam(new Date()));
                  setDateTask(task);
                }}
                onToggle={() => onToggle(task)}
                task={task}
              />
            ) : (
              <TaskRow
                key={task.id}
                onOpen={openTask}
                onToggle={() => onToggle(task)}
                task={{
                  id: task.id,
                  title: task.title,
                  list: list?.name ?? '',
                  time: task.due_date ?? '无时间',
                  color: colors.textTertiary,
                  priority: task.priority,
                  completed: task.status === 'done',
                }}
              />
            );
          })
        )}
        {updateTaskFields.isError ? (
          <View accessibilityRole="alert" style={styles.actionError}>
            <AppIcon color={colors.danger} name="alert-circle-outline" size={17} />
            <Text style={styles.actionErrorText}>
              {errorMessage(updateTaskFields.error, '操作失败，请稍后重试。')}
            </Text>
          </View>
        ) : null}
      </ScrollView>
      {view.type === 'list' && listActionsVisible ? (
        <TaskListActionSheet
          list={view.list}
          lists={allLists}
          onChanged={onListChanged}
          onClose={() => setListActionsVisible(false)}
        />
      ) : null}
      <Modal
        animationType="fade"
        onRequestClose={() => setDateTask(null)}
        statusBarTranslucent
        transparent
        visible={dateTask !== null}
      >
        <ModalSheet maxHeight="58%" onClose={() => setDateTask(null)}>
          <View style={styles.dateSheetHeader}>
            <View>
              <Text accessibilityRole="header" style={styles.dateSheetTitle}>设置日期</Text>
              <Text numberOfLines={1} style={styles.dateSheetTaskTitle}>{dateTask?.title}</Text>
            </View>
            <Pressable
              accessibilityLabel="关闭日期选择"
              accessibilityRole="button"
              onPress={() => setDateTask(null)}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
            >
              <AppIcon color={colors.text} name="close" size={22} />
            </Pressable>
          </View>
          <View style={styles.dateWheelWrap}>
            <DateWheel
              endYear={new Date().getFullYear() + 10}
              onChange={setSelectedDate}
              startYear={new Date().getFullYear() - 1}
              value={selectedDate}
            />
          </View>
          <View style={styles.dateSheetFooter}>
            <AppButton
              disabled={updateTaskFields.isPending}
              label={updateTaskFields.isPending ? '保存中…' : '确定'}
              onPress={() => {
                if (!dateTask) return;
                const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
                updateTaskFields.mutate(
                  {
                    task: dateTask,
                    data: buildSetTaskDateRequest(selectedDate, timezone),
                  },
                  { onSuccess: () => setDateTask(null) },
                );
              }}
            />
          </View>
        </ModalSheet>
      </Modal>
    </AppScreen>
  );
}

function AnytimeTaskRow({
  busy,
  list,
  onAddToday,
  onOpen,
  onPickDate,
  onToggle,
  task,
}: {
  busy: boolean;
  list?: TaskList;
  onAddToday: () => void;
  onOpen: () => void;
  onPickDate: () => void;
  onToggle: () => void;
  task: Task;
}) {
  return (
    <View style={styles.anytimeTask}>
      <View style={styles.anytimeTaskMain}>
        <Pressable
          accessibilityLabel={`完成任务：${task.title}`}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: false }}
          hitSlop={10}
          onPress={onToggle}
          style={styles.taskCheckbox}
        />
        <Pressable accessibilityRole="button" onPress={onOpen} style={styles.anytimeTaskCopy}>
          <Text numberOfLines={2} style={styles.anytimeTaskTitle}>{task.title}</Text>
          <View style={styles.anytimeTaskMeta}>
            {list ? <TaskListIconChip list={list} size={20} /> : null}
            <Text numberOfLines={1} style={styles.anytimeTaskList}>{list?.name ?? '任务'}</Text>
          </View>
        </Pressable>
        {task.priority !== 'normal' ? (
          <AppIcon
            color={task.priority === 'high' ? colors.danger : colors.textTertiary}
            name="flag"
            size={16}
          />
        ) : null}
      </View>
      <View style={styles.anytimeActions}>
        <Pressable
          accessibilityLabel={`加入今天：${task.title}`}
          accessibilityRole="button"
          disabled={busy}
          onPress={onAddToday}
          style={({ pressed }) => [styles.anytimeAction, pressed && styles.pressed]}
        >
          <AppIcon color={colors.primaryStrong} name="today" size={16} />
          <Text style={styles.anytimeActionText}>加入今天</Text>
        </Pressable>
        <Pressable
          accessibilityLabel={`设置日期：${task.title}`}
          accessibilityRole="button"
          disabled={busy}
          onPress={onPickDate}
          style={({ pressed }) => [
            styles.anytimeAction,
            styles.anytimeActionSecondary,
            pressed && styles.pressed,
          ]}
        >
          <AppIcon color={colors.textSecondary} name="calendar-outline" size={16} />
          <Text style={[styles.anytimeActionText, styles.anytimeActionTextSecondary]}>设置日期</Text>
        </Pressable>
        {busy ? <ActivityIndicator color={colors.primary} size="small" /> : null}
      </View>
    </View>
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
  const merged = [...pools.today, ...pools.tomorrow, ...pools.unscheduled, ...pools.completed];
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
  anytimeEntry: {
    minHeight: 74,
    marginTop: 18,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
  },
  anytimeEntryIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  anytimeEntryCopy: {
    minWidth: 0,
    flex: 1,
  },
  anytimeEntryTitle: {
    color: colors.text,
    fontFamily,
    ...typography.bodyStrong,
  },
  anytimeEntrySubtitle: {
    marginTop: 1,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  anytimeTask: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  anytimeTaskMain: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  taskCheckbox: {
    width: 20,
    height: 20,
    borderWidth: 1.7,
    borderColor: colors.borderStrong,
    borderRadius: radius.pill,
  },
  anytimeTaskCopy: {
    minWidth: 0,
    flex: 1,
  },
  anytimeTaskTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '500',
  },
  anytimeTaskMeta: {
    marginTop: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  anytimeTaskList: {
    minWidth: 0,
    color: colors.textTertiary,
    fontFamily,
    ...typography.meta,
  },
  anytimeActions: {
    minHeight: 34,
    marginTop: 8,
    marginLeft: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  anytimeAction: {
    minHeight: 34,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  anytimeActionSecondary: {
    backgroundColor: colors.surfaceSubtle,
  },
  anytimeActionText: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
  },
  anytimeActionTextSecondary: {
    color: colors.textSecondary,
  },
  actionError: {
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
  },
  actionErrorText: {
    minWidth: 0,
    flex: 1,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  dateSheetHeader: {
    minHeight: 64,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateSheetTitle: {
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  dateSheetTaskTitle: {
    maxWidth: 260,
    marginTop: 1,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  dateWheelWrap: {
    paddingHorizontal: 16,
  },
  dateSheetFooter: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
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
