import {
  deleteTask,
  errorMessage,
  updateTask,
  useGetTask,
  useListProjects,
  useListTaskLists,
  type ProjectStatus,
  type Task,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { StatePanel } from '@/components/ui/state-panel';
import {
  describeTaskReminder,
  hasReminder,
  useTaskReminder,
} from '@/features/tasks/use-task-reminder';
import { formatMonthDay } from '@/utils/format';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

const priorityLabels: Record<Task['priority'], { label: string; color: string }> = {
  high: { label: '高', color: colors.danger },
  normal: { label: '普通', color: colors.warning },
  low: { label: '低', color: colors.textTertiary },
};

const statusLabels: Record<Task['status'], string> = {
  todo: '待办',
  doing: '进行中',
  done: '已完成',
  cancelled: '已取消',
};
const projectStatuses: ProjectStatus[] = ['active', 'paused', 'archived'];

export default function TaskDetailScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const taskQuery = useGetTask(id ?? '', { query: { enabled: Boolean(id) } });
  const listsQuery = useListTaskLists({ list_kind: 'tasks' });
  const projectsQuery = useListProjects({ status: projectStatuses, limit: 100 });
  const task = taskQuery.data?.data;

  const listName = listsQuery.data?.data.find((list) => list.id === task?.list_id)?.name ?? '—';
  const projectName = projectsQuery.data?.data.find((project) => project.id === task?.project_id)?.title ?? '无';

  const runAction = async (action: () => Promise<unknown>) => {
    setActionError(null);
    setBusy(true);
    try {
      await action();
      await queryClient.invalidateQueries();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const toggleDone = () => {
    if (!task) return;
    void runAction(() =>
      updateTask(
        task.id,
        { status: task.status === 'done' ? 'todo' : 'done' },
        { headers: { 'If-Match': String(task.version) } },
      ),
    );
  };

  const removeTask = () => {
    if (!task) return;
    Alert.alert('删除任务？', '删除后不可撤销，相关页面也将不再显示这条任务。', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => void runAction(async () => {
        await deleteTask(task.id);
        router.back();
      }) },
    ]);
  };

  if (taskQuery.isPending) {
    return (
      <AppScreen>
        <NavHeader title="任务详情" />
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </AppScreen>
    );
  }

  if (taskQuery.isError || !task) {
    return (
      <AppScreen>
        <NavHeader title="任务详情" />
        <View style={styles.content}>
          <StatePanel
            actionLabel="返回"
            icon="alert-circle-outline"
            message={errorMessage(taskQuery.error, '这个任务可能已被删除。')}
            onAction={() => router.back()}
            title="打不开这个任务"
          />
        </View>
      </AppScreen>
    );
  }

  const priority = priorityLabels[task.priority];

  return (
    <AppScreen>
      <NavHeader
        right={
          <View style={styles.headerActions}>
            <Pressable accessibilityLabel="编辑任务" accessibilityRole="button" disabled={busy} hitSlop={10} onPress={() => router.push({ pathname: '/tasks/[id]/edit' as never, params: { id: task.id } })}>
              <Text style={styles.editLabel}>编辑</Text>
            </Pressable>
            <Pressable accessibilityLabel="删除任务" accessibilityRole="button" disabled={busy} hitSlop={10} onPress={removeTask}>
              <AppIcon color={colors.danger} name="trash-outline" size={21} />
            </Pressable>
          </View>
        }
        title="任务详情"
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.taskTitle}>{task.title}</Text>

        <Pressable
          accessibilityLabel={task.status === 'done' ? '标记为未完成' : '标记为完成'}
          accessibilityRole="button"
          accessibilityState={{ checked: task.status === 'done' }}
          disabled={busy}
          onPress={toggleDone}
          style={({ pressed }) => [
            styles.statusButton,
            task.status === 'done' && styles.statusButtonDone,
            pressed && styles.pressed,
          ]}
        >
          <AppIcon
            color={task.status === 'done' ? colors.background : colors.primaryStrong}
            name={task.status === 'done' ? 'checkmark-circle' : 'ellipse-outline'}
            size={20}
          />
          <Text
            style={[styles.statusText, task.status === 'done' && styles.statusTextDone]}
          >
            {task.status === 'done' ? '已完成' : '标记为完成'}
          </Text>
        </Pressable>

        {actionError ? <Text style={styles.error}>{actionError}</Text> : null}

        <View style={styles.detailCard}>
          <DetailRow label="状态" value={statusLabels[task.status]} />
          <DetailRow label="所属清单" value={listName} />
          <DetailRow label="所属项目" value={projectName} />
          <DetailRow color={priority.color} label="优先级" value={priority.label} />
          <DetailRow label="截止" value={dueLabel(task)} />
          <DetailRow label="计划时间" value={scheduleLabel(task)} />
          <DetailRow label="加入日期" value={task.focus_date ? formatMonthDay(task.focus_date) : '未设置'} />
          <ReminderRow task={task} />
          {task.estimated_minutes ? (
            <DetailRow label="预计时长" value={`${task.estimated_minutes} 分钟`} />
          ) : null}
        </View>

        {task.description ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>备注</Text>
            <Text style={styles.description}>{task.description}</Text>
          </View>
        ) : null}

        <View style={styles.aiSection}>
          <Text style={styles.sectionTitle}>AI 操作</Text>
          <View style={styles.aiActions}>
            <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/ai', params: { taskAction: 'split', taskId: task.id } })} style={({ pressed }) => [styles.aiAction, pressed && styles.pressed]}>
              <AppIcon color={colors.primaryStrong} name="sparkles-outline" size={19} />
              <Text style={styles.aiActionText}>AI 帮我拆</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/ai', params: { taskAction: 'schedule', taskId: task.id } })} style={({ pressed }) => [styles.aiAction, pressed && styles.pressed]}>
              <AppIcon color={colors.primaryStrong} name="calendar-outline" size={19} />
              <Text style={styles.aiActionText}>智能安排</Text>
            </Pressable>
          </View>
          <Text style={styles.aiHint}>AI 只生成待确认建议；确认后才会创建子任务或写入计划时间。</Text>
        </View>

        {task.created_by !== 'user' ? (
          <View style={styles.provenance}>
            <AppIcon color={colors.primaryStrong} name="sparkles-outline" size={16} />
            <Text style={styles.provenanceText}>
              这条任务由 AI 从一次输入整理生成，并经过你的确认。
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </AppScreen>
  );
}

/**
 * 到期提醒的开关。
 *
 * 没有截止信息时不给开：契约上就不允许（「没有截止信息时不能设置提醒」），
 * 摆一个按下去必然报错的开关只会让人困惑。这时说清楚为什么不能开。
 */
function ReminderRow({ task }: { task: Task }) {
  const reminder = useTaskReminder();
  const hasDue = Boolean(task.due_date || task.due_at);
  const enabled = hasReminder(task);

  if (!hasDue) {
    return (
      <View style={styles.detailRow}>
        <Text style={styles.label}>提醒</Text>
        <Text style={[styles.value, styles.valueMuted]}>先设置截止日期</Text>
      </View>
    );
  }

  return (
    <View style={styles.detailRow}>
      <Text style={styles.label}>提醒</Text>
      <View style={styles.reminderControl}>
        <Text style={styles.value}>
          {enabled ? describeTaskReminder(task.reminders) : `当天 ${reminder.defaultTime}`}
        </Text>
        <Switch
          accessibilityLabel="到期当天提醒我"
          disabled={reminder.saving}
          onValueChange={(next) => void reminder.setEnabled(task, next)}
          thumbColor={colors.background}
          trackColor={{ false: colors.borderStrong, true: colors.primary }}
          value={enabled}
        />
      </View>
    </View>
  );
}

function DetailRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

/** 截止展示：只有日期时不显示虚构时刻。 */
function dueLabel(task: Task): string {
  if (task.due_at) {
    return new Date(task.due_at).toLocaleString('zh-CN', {
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  if (task.due_date) {
    return `${formatMonthDay(task.due_date)}截止`;
  }
  return '未设置';
}

function scheduleLabel(task: Task): string {
  if (!task.scheduled_start_at) return '未设置';
  const start = new Date(task.scheduled_start_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  if (!task.scheduled_end_at) return start;
  const end = new Date(task.scheduled_end_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return `${start}–${end}`;
}

const styles = StyleSheet.create({
  headerActions: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 18 },
  editLabel: { color: colors.primaryStrong, fontFamily, ...typography.bodyStrong },
  aiSection: { marginTop: 22, gap: 10 },
  aiActions: { flexDirection: 'row', gap: 10 },
  aiAction: { minHeight: 50, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  aiActionText: { color: colors.primaryStrong, fontFamily, ...typography.label, fontWeight: '600' },
  aiHint: { color: colors.textSecondary, fontFamily, ...typography.meta },
  reminderControl: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  valueMuted: {
    color: colors.textTertiary,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskTitle: {
    marginTop: 8,
    color: colors.text,
    fontFamily,
    ...typography.detail,
  },
  statusButton: {
    minHeight: 52,
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  statusButtonDone: {
    backgroundColor: colors.primary,
  },
  statusText: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.bodyStrong,
  },
  statusTextDone: {
    color: colors.background,
  },
  pressed: {
    opacity: 0.75,
  },
  error: {
    marginTop: 12,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  detailCard: {
    marginTop: 18,
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  detailRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
  },
  value: {
    color: colors.text,
    fontFamily,
    ...typography.bodyStrong,
  },
  section: {
    marginTop: 20,
  },
  sectionTitle: {
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  description: {
    marginTop: 8,
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
  },
  provenance: {
    marginTop: 20,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  provenanceText: {
    flex: 1,
    color: colors.primaryStrong,
    fontFamily,
    ...typography.meta,
  },
});
