import { useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AiFab } from '@/components/ui/ai-fab';
import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { PageHeader } from '@/components/ui/page-header';
import { SectionTitle } from '@/components/ui/section-title';
import { TaskRow } from '@/features/tasks/components/task-row';
import {
  completedTasks,
  todayTasks,
  tomorrowTasks,
  unscheduledTasks,
  type TaskItem,
} from '@/mocks/data';
import { colors, fontFamily, radius } from '@/theme/tokens';

type ScopeKey = 'today' | 'tomorrow' | 'completed' | 'unscheduled';

type ActiveView =
  | { type: 'scope'; key: ScopeKey }
  | { type: 'list'; name: string }
  | null;

type ListDefinition = {
  name: string;
  icon: ComponentProps<typeof AppIcon>['name'];
  iconColor: string;
  iconBackground: string;
};

const timeShortcuts: { key: Exclude<ScopeKey, 'unscheduled'>; label: string }[] = [
  { key: 'today', label: '今天' },
  { key: 'tomorrow', label: '明天' },
  { key: 'completed', label: '已完成' },
];

const listDefinitions: ListDefinition[] = [
  {
    name: '收集箱',
    icon: 'file-tray-outline',
    iconColor: colors.primaryStrong,
    iconBackground: colors.primarySoft,
  },
  {
    name: '工作',
    icon: 'briefcase-outline',
    iconColor: colors.blue,
    iconBackground: '#EAF2FF',
  },
  {
    name: '生活',
    icon: 'home-outline',
    iconColor: colors.warning,
    iconBackground: '#FFF5DE',
  },
  {
    name: '购物清单',
    icon: 'cart-outline',
    iconColor: colors.purple,
    iconBackground: '#F2EEFF',
  },
];

const activePlanTasks = [...todayTasks, ...tomorrowTasks, ...unscheduledTasks];
const allPlanTasks = [...activePlanTasks, ...completedTasks];

function getScopeTitle(key: ScopeKey) {
  if (key === 'today') return '今天';
  if (key === 'tomorrow') return '明天';
  if (key === 'completed') return '已完成';
  return '待安排';
}

function getEmptyCopy(key: ScopeKey) {
  if (key === 'today') return '今天暂时没有需要处理的任务';
  if (key === 'tomorrow') return '明天还没有安排任务';
  if (key === 'completed') return '完成任务后会显示在这里';
  return '所有任务都已经安排好了';
}

export default function ListsScreen() {
  const router = useRouter();
  const [activeView, setActiveView] = useState<ActiveView>(null);
  const [completedIds, setCompletedIds] = useState<Set<string>>(
    () => new Set(completedTasks.map((task) => task.id)),
  );

  const toggleTask = (taskId: string) => {
    setCompletedIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const shortcutCounts: Record<Exclude<ScopeKey, 'unscheduled'>, number> = {
    today: todayTasks.filter((task) => !completedIds.has(task.id)).length,
    tomorrow: tomorrowTasks.filter((task) => !completedIds.has(task.id)).length,
    completed: completedIds.size,
  };
  const unscheduledCount = unscheduledTasks.filter(
    (task) => !completedIds.has(task.id),
  ).length;

  const detail = useMemo(() => {
    if (!activeView) return null;

    if (activeView.type === 'list') {
      const tasks = activePlanTasks.filter((task) => task.list === activeView.name);
      return {
        title: activeView.name,
        subtitle: `${tasks.filter((task) => !completedIds.has(task.id)).length} 项待处理`,
        emptyCopy: '这里还没有任务',
        tasks,
      };
    }

    const { key } = activeView;
    const tasks: TaskItem[] =
      key === 'today'
        ? todayTasks
        : key === 'tomorrow'
          ? tomorrowTasks
          : key === 'unscheduled'
            ? unscheduledTasks
            : allPlanTasks.filter((task) => completedIds.has(task.id));
    const pendingCount = tasks.filter((task) => !completedIds.has(task.id)).length;

    return {
      title: getScopeTitle(key),
      subtitle: key === 'completed' ? `${tasks.length} 项记录` : `${pendingCount} 项待处理`,
      emptyCopy: getEmptyCopy(key),
      tasks,
    };
  }, [activeView, completedIds]);

  if (activeView && detail) {
    return (
      <AppScreen>
        <NavHeader onBack={() => setActiveView(null)} title={detail.title} />
        <ScrollView contentContainerStyle={styles.detailContent} showsVerticalScrollIndicator={false}>
          <View style={styles.detailSummary}>
            <Text style={styles.detailSummaryText}>{detail.subtitle}</Text>
          </View>
          {detail.tasks.length > 0 ? (
            detail.tasks.map((task) => (
              <TaskRow
                completed={completedIds.has(task.id)}
                key={task.id}
                onOpen={() =>
                  router.push({ pathname: '/tasks/[id]', params: { id: task.id } })
                }
                onToggle={() => toggleTask(task.id)}
                task={task}
              />
            ))
          ) : (
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <AppIcon color={colors.primaryStrong} name="checkmark" size={21} />
              </View>
              <Text style={styles.emptyTitle}>{detail.emptyCopy}</Text>
              <Text style={styles.emptyCopy}>可以通过底部“新增”随时补充任务</Text>
            </View>
          )}
        </ScrollView>
        <AiFab count={1} />
      </AppScreen>
    );
  }

  return (
    <AppScreen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <PageHeader
          action={
            <Pressable
              accessibilityLabel="打开日历"
              accessibilityRole="button"
              onPress={() => router.push('/calendar')}
              style={({ pressed }) => [styles.calendarButton, pressed && styles.pressed]}
            >
              <AppIcon color={colors.primaryStrong} name="calendar-outline" size={22} />
            </Pressable>
          }
          subtitle="安排未来，整理所有任务"
          title="计划"
        />

        <View accessibilityLabel="按时间查看任务" style={styles.timeShortcuts}>
          {timeShortcuts.map((shortcut, index) => (
            <View key={shortcut.key} style={styles.timeShortcutSlot}>
              {index > 0 ? <View style={styles.timeShortcutDivider} /> : null}
              <Pressable
                accessibilityLabel={`${shortcut.label}，${shortcutCounts[shortcut.key]} 项`}
                accessibilityRole="button"
                onPress={() => setActiveView({ type: 'scope', key: shortcut.key })}
                style={({ pressed }) => [styles.timeShortcut, pressed && styles.shortcutPressed]}
              >
                <Text style={styles.timeShortcutLabel}>{shortcut.label}</Text>
                <Text style={styles.timeShortcutCount}>{shortcutCounts[shortcut.key]}</Text>
              </Pressable>
            </View>
          ))}
        </View>

        <Pressable
          accessibilityLabel={`${unscheduledCount} 项待安排，补充日期和时间`}
          accessibilityRole="button"
          onPress={() => setActiveView({ type: 'scope', key: 'unscheduled' })}
          style={({ pressed }) => [styles.unscheduledRow, pressed && styles.unscheduledPressed]}
        >
          <View style={styles.unscheduledIcon}>
            <AppIcon color={colors.primaryStrong} name="time-outline" size={20} />
          </View>
          <View style={styles.unscheduledCopy}>
            <Text style={styles.unscheduledTitle}>{unscheduledCount} 项待安排</Text>
            <Text style={styles.unscheduledMeta}>补充日期，让任务在合适的时候出现</Text>
          </View>
          <AppIcon color={colors.primaryStrong} name="chevron-forward" size={18} />
        </Pressable>

        <SectionTitle
          count={`${listDefinitions.length} 项`}
          style={styles.listSectionTitle}
          title="清单"
        />
        <View style={styles.listRows}>
          {listDefinitions.map((item) => {
            const count = activePlanTasks.filter(
              (task) => task.list === item.name && !completedIds.has(task.id),
            ).length;

            return (
              <Pressable
                accessibilityLabel={`${item.name}，${count} 项待处理`}
                accessibilityRole="button"
                key={item.name}
                onPress={() => setActiveView({ type: 'list', name: item.name })}
                style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}
              >
                <View style={[styles.listIcon, { backgroundColor: item.iconBackground }]}>
                  <AppIcon color={item.iconColor} name={item.icon} size={19} />
                </View>
                <Text style={styles.listTitle}>{item.name}</Text>
                <Text style={styles.listCount}>{count}</Text>
                <AppIcon color={colors.borderStrong} name="chevron-forward" size={18} />
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <AiFab count={1} />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 112,
  },
  calendarButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  pressed: {
    opacity: 0.58,
  },
  timeShortcuts: {
    height: 62,
    marginTop: 8,
    flexDirection: 'row',
    overflow: 'hidden',
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  timeShortcutSlot: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeShortcutDivider: {
    width: StyleSheet.hairlineWidth,
    height: 26,
    backgroundColor: colors.border,
  },
  timeShortcut: {
    flex: 1,
    height: 62,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  shortcutPressed: {
    backgroundColor: colors.surface,
  },
  timeShortcutLabel: {
    color: colors.text,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  timeShortcutCount: {
    minWidth: 18,
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  unscheduledRow: {
    minHeight: 74,
    marginTop: 16,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
  },
  unscheduledPressed: {
    backgroundColor: colors.primaryTrack,
  },
  unscheduledIcon: {
    width: 38,
    height: 38,
    marginRight: 12,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryTrack,
  },
  unscheduledCopy: {
    flex: 1,
    paddingRight: 8,
  },
  unscheduledTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '600',
  },
  unscheduledMeta: {
    marginTop: 3,
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 12,
    lineHeight: 17,
  },
  listSectionTitle: {
    marginTop: 20,
  },
  listRows: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  listRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  listIcon: {
    width: 34,
    height: 34,
    marginRight: 12,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listTitle: {
    flex: 1,
    color: colors.text,
    fontFamily,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '500',
  },
  listCount: {
    minWidth: 24,
    marginRight: 8,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'right',
  },
  detailContent: {
    paddingHorizontal: 16,
    paddingBottom: 112,
  },
  detailSummary: {
    minHeight: 44,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  detailSummaryText: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
  },
  emptyState: {
    minHeight: 260,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  emptyTitle: {
    marginTop: 14,
    color: colors.text,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyCopy: {
    marginTop: 5,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
});
