import { errorMessage, useGetToday, type TodayTask } from '@steward/api-client';
import { type Href, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AI_FAB_TAB_BAR_INSET, AiFab } from '@/components/ui/ai-fab';
import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { PageHeader } from '@/components/ui/page-header';
import { SectionTitle } from '@/components/ui/section-title';
import { StatePanel } from '@/components/ui/state-panel';
import {
  resolveHomeEntryTab,
  type HomeTopTabId,
} from '@/features/home/home-top-navigation';
import { HomeTopTabs } from '@/features/home/home-top-tabs';
import { NotificationEntry } from '@/features/notifications/notification-entry';
import { MemoriesHome } from '@/features/memories/memories-home';
import { MoodJournalContent } from '@/features/mood-journal/mood-journal-content';
import { RelationshipsContent } from '@/features/relationships/relationships-content';
import {
  describeReminder,
  usePendingReminders,
} from '@/features/reminders/use-pending-reminders';
import { AgendaEventRow } from '@/features/plan/agenda-event-row';
import { dayAgendaItems } from '@/features/plan/day-agenda';
import { TaskRow } from '@/features/tasks/components/task-row';
import { useToggleTaskDone } from '@/features/tasks/use-task-actions';
import { colors, fontFamily, radius } from '@/theme/tokens';

type HomeShortcut = {
  label: string;
  icon: React.ComponentProps<typeof AppIcon>['name'];
  color: string;
  background: string;
  href: Href;
};

const homeShortcuts: HomeShortcut[] = [
  {
    label: '运动',
    icon: 'fitness-outline',
    color: colors.primaryStrong,
    background: colors.primarySoft,
    href: '/features/exercise' as Href,
  },
  {
    label: '食谱',
    icon: 'restaurant-outline',
    color: '#D56C28',
    background: '#FFF1E7',
    href: '/features/recipes',
  },
  {
    label: '番茄钟',
    icon: 'timer-outline',
    color: '#D9485F',
    background: '#FFF0F2',
    href: '/focus',
  },
  {
    label: '记账',
    icon: 'wallet-outline',
    color: '#3978B8',
    background: '#EAF4FF',
    href: { pathname: '/features/[slug]', params: { slug: 'ledger' } },
  },
  {
    label: '重要日',
    icon: 'gift-outline',
    color: '#C04C81',
    background: '#FDEEF5',
    href: { pathname: '/features/[slug]', params: { slug: 'important-dates' } },
  },
  {
    label: '购物',
    icon: 'cart-outline',
    color: '#7657C8',
    background: '#F2EEFF',
    href: { pathname: '/features/[slug]', params: { slug: 'shopping' } },
  },
  {
    label: '复盘',
    icon: 'refresh-outline',
    color: '#187A75',
    background: '#E9F7F5',
    href: { pathname: '/features/[slug]', params: { slug: 'review' } },
  },
  {
    label: '更多',
    icon: 'grid-outline',
    color: '#68716D',
    background: '#EEF1F0',
    href: { pathname: '/features/[slug]', params: { slug: 'more' } },
  },
];

/** 分组标题：与服务端返回的顺序一一对应，客户端不重排。 */
const groupLabels: Record<TodayTask['group'], string> = {
  overdue: '已逾期',
  due_today: '今天截止',
  scheduled_today: '今天已排期',
  manual: '加入今天',
};

export default function HomeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ homeTab?: string }>();
  const initialHomeTab = resolveHomeEntryTab(params.homeTab);
  const [activeHomeTab, setActiveHomeTab] = useState<HomeTopTabId>(initialHomeTab);
  const [itemsExpanded, setItemsExpanded] = useState(false);
  const today = useGetToday(undefined, { query: { refetchInterval: 60_000 } });
  const toggleDone = useToggleTaskDone();

  useFocusEffect(
    useCallback(() => {
      if (params.homeTab === undefined) return;

      setActiveHomeTab(resolveHomeEntryTab(params.homeTab));
      setItemsExpanded(false);

      // 只消费显式回跳参数。普通二级页返回时没有参数，因此保留用户离开前的分区。
      router.setParams({ homeTab: undefined });
    }, [params.homeTab, router]),
  );

  const items = useMemo(() => dayAgendaItems(today.data?.data), [today.data]);

  // 首页默认只渲染前 4 项；展开只改变可见数量，不改变收录与排序。
  const visibleItems = itemsExpanded ? items : items.slice(0, 4);
  const remainingItemCount = Math.max(0, items.length - visibleItems.length);
  const showItemToggle = itemsExpanded || remainingItemCount > 0;

  return (
    <AppScreen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          activeHomeTab === 'today' ? (
            <RefreshControl
              onRefresh={() => void today.refetch()}
              refreshing={today.isRefetching}
            />
          ) : undefined
        }
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[1]}
      >
        <PageHeader
          action={
            <View style={styles.headerActions}>
              <NotificationEntry />
              <Pressable
                accessibilityLabel="打开我的"
                accessibilityRole="button"
                onPress={() => router.push('/me')}
                style={styles.avatar}
              >
                <AppIcon color={colors.background} name="person" size={20} />
              </Pressable>
            </View>
          }
          subtitle={formatToday(today.data?.data.date)}
          title="首页"
        />

        <HomeTopTabs
          onChange={(tab) => {
            setActiveHomeTab(tab);
            setItemsExpanded(false);
          }}
          value={activeHomeTab}
        />

        {activeHomeTab === 'today' ? (
          <View key="today-home-content">
            <PendingRemindersBlock />

            <View style={styles.shortcutPanel}>
              <View style={styles.shortcutGrid}>
                {homeShortcuts.map((item) => (
                  <Pressable
                    accessibilityLabel={`打开${item.label}`}
                    accessibilityRole="button"
                    key={item.label}
                    onPress={() => router.push(item.href)}
                    style={({ pressed }) => [
                      styles.shortcutItem,
                      pressed && styles.shortcutItemPressed,
                    ]}
                  >
                    <View style={[styles.shortcutIcon, { backgroundColor: item.background }]}>
                      <AppIcon color={item.color} name={item.icon} size={21} />
                    </View>
                    <Text style={styles.shortcutLabel}>{item.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <SectionTitle
              count={today.data ? `${items.length} 项` : undefined}
              style={styles.homeSectionTitle}
              title="今天要做"
            />

            {today.isPending ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : today.isError ? (
              <StatePanel
                actionLabel="重试"
                icon="cloud-offline-outline"
                message={errorMessage(today.error, '暂时无法加载今天的事项。')}
                onAction={() => void today.refetch()}
                title="加载失败"
              />
            ) : items.length === 0 ? (
              <StatePanel
                actionLabel="记一件事"
                compact
                icon="sunny-outline"
                message="今天没有安排，想到什么就记下来。"
                onAction={() => router.push('/capture/new')}
                title="今天很清爽"
              />
            ) : (
              <>
                {visibleItems.map((entry, index) => {
                  if (entry.kind === 'event') {
                    return <AgendaEventRow date={today.data!.data.date} event={entry.event} key={entry.key} timezone={today.data!.data.timezone} />;
                  }
                  const item = entry.item;
                  const previous = visibleItems[index - 1];
                  return (
                  <View key={item.task.id}>
                    {!previous || previous.kind !== 'task' || previous.item.group !== item.group ? (
                      <Text style={styles.groupLabel}>{groupLabels[item.group]}</Text>
                    ) : null}
                    <TaskRow
                      onOpen={() =>
                        router.push({ pathname: '/tasks/[id]', params: { id: item.task.id } })
                      }
                      onToggle={() => toggleDone.mutate(item.task)}
                      task={{
                        id: item.task.id,
                        title: item.task.title,
                        list: item.list_name ?? '',
                        time: formatTaskTime(item.task),
                        color: listColor(item.list_color),
                        priority: item.task.priority,
                        completed: item.task.status === 'done',
                      }}
                    />
                  </View>
                );
                })}
                {showItemToggle ? (
                  <Pressable
                    accessibilityLabel={
                      itemsExpanded ? '收起今日事项' : `展开剩余 ${remainingItemCount} 项事项`
                    }
                    accessibilityRole="button"
                    accessibilityState={{ expanded: itemsExpanded }}
                    onPress={() => setItemsExpanded((current) => !current)}
                    style={({ pressed }) => [
                      styles.taskToggle,
                      pressed && styles.taskTogglePressed,
                    ]}
                  >
                    <Text style={styles.taskToggleText}>
                      {itemsExpanded ? '收起' : `展开剩余 ${remainingItemCount} 项`}
                    </Text>
                    <AppIcon
                      color={colors.primaryStrong}
                      name={itemsExpanded ? 'chevron-up' : 'chevron-down'}
                      size={16}
                    />
                  </Pressable>
                ) : null}
              </>
            )}
          </View>
        ) : activeHomeTab === 'memories' ? (
          <MemoriesHome key="memories-home-content" />
        ) : activeHomeTab === 'relationships' ? (
          <RelationshipsContent />
        ) : (
          <MoodJournalContent />
        )}
      </ScrollView>
      <AiFab bottomInset={AI_FAB_TAB_BAR_INSET} />
    </AppScreen>
  );
}

function formatToday(date: string | undefined): string {
  const target = date ? new Date(`${date}T00:00:00`) : new Date();
  const weekday = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][
    target.getDay()
  ];
  return `${target.getMonth() + 1}月${target.getDate()}日 · ${weekday}`;
}

/** 任务的时间展示：只有日期时不显示虚构时刻。 */
function formatTaskTime(task: TodayTask['task']): string {
  if (task.due_at) {
    const at = new Date(task.due_at);
    return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  }
  if (task.scheduled_start_at) {
    const at = new Date(task.scheduled_start_at);
    return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  }
  if (task.due_date) {
    return '当日截止';
  }
  return '无时间';
}

/** 把清单色板名映射成实际颜色。 */
function listColor(name: string | null | undefined): string {
  switch (name) {
    case 'blue':
      return colors.blue;
    case 'green':
      return colors.success;
    case 'orange':
      return colors.warning;
    case 'purple':
      return colors.purple;
    case 'pink':
      return colors.pink;
    default:
      return colors.textTertiary;
  }
}

/**
 * 到点了、还没处理的提醒。
 *
 * 放在最前面：提醒是有时限的，错过就没有意义了。没有待提醒时整块不渲染，
 * 不占一行去说「暂无提醒」——首页寸土寸金。
 */
function PendingRemindersBlock() {
  const router = useRouter();
  const reminders = usePendingReminders();
  const today = new Date();

  if (reminders.loading) return null;
  if (reminders.failure && reminders.items.length === 0) {
    return (
      <StatePanel
        actionLabel="重试"
        compact
        icon="cloud-offline-outline"
        message={reminders.failure}
        onAction={() => void reminders.refetch()}
        title="提醒加载失败"
      />
    );
  }
  if (reminders.items.length === 0) return null;

  return (
    <View style={styles.reminderBlock}>
      {reminders.items.map((item) => (
        <View key={item.id} style={styles.reminderRow}>
          <Pressable
            accessibilityLabel={`${item.title}，${describeReminder(item, today)}`}
            accessibilityRole="button"
            onPress={() =>
              router.push(
                item.source_type === 'task'
                  ? ({ pathname: '/tasks/[id]', params: { id: item.source_id } } as Href)
                  : ('/calendar' as Href),
              )
            }
            style={({ pressed }) => [styles.reminderMain, pressed && styles.reminderPressed]}
          >
            <View style={styles.reminderIcon}>
              <AppIcon
                color={colors.primaryStrong}
                name={item.event_kind === 'important_date' ? 'gift-outline' : 'alarm-outline'}
                size={18}
              />
            </View>
            <View style={styles.reminderCopy}>
              <Text numberOfLines={1} style={styles.reminderTitle}>
                {item.title}
              </Text>
              <Text style={styles.reminderMeta}>{describeReminder(item, today)}</Text>
            </View>
          </Pressable>
          <Pressable
            accessibilityLabel={`知道了，不再提醒 ${item.title}`}
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => void reminders.dismiss(item.id)}
            style={({ pressed }) => [styles.reminderDismiss, pressed && styles.reminderPressed]}
          >
            <Text style={styles.reminderDismissText}>知道了</Text>
          </Pressable>
        </View>
      ))}
      {reminders.failure ? <Text style={styles.reminderFailure}>{reminders.failure}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reminderBlock: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
  },
  reminderRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  reminderMain: {
    flex: 1,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  reminderIcon: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.background,
  },
  reminderCopy: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  reminderTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  reminderMeta: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
  },
  reminderDismiss: {
    minHeight: 44,
    paddingHorizontal: 4,
    justifyContent: 'center',
  },
  reminderDismissText: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
  },
  reminderFailure: {
    paddingBottom: 8,
    color: colors.danger,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
  },
  reminderPressed: {
    opacity: 0.6,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 92,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  shortcutPanel: {
    marginTop: 12,
    marginBottom: 4,
    paddingTop: 16,
    paddingHorizontal: 4,
    paddingBottom: 8,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  shortcutGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  shortcutItem: {
    width: '25%',
    minHeight: 76,
    alignItems: 'center',
  },
  shortcutItemPressed: {
    opacity: 0.56,
  },
  shortcutIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shortcutLabel: {
    marginTop: 6,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 12,
    lineHeight: 17,
  },
  homeSectionTitle: {
    marginTop: 12,
  },
  loading: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  groupLabel: {
    marginTop: 10,
    marginBottom: 2,
    color: colors.textTertiary,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
  },
  taskToggle: {
    minHeight: 44,
    marginTop: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  taskTogglePressed: {
    backgroundColor: '#EAEEEC',
  },
  taskToggleText: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
  },
});
