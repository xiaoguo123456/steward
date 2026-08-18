import { type Href, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AiFab } from '@/components/ui/ai-fab';
import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { PageHeader } from '@/components/ui/page-header';
import { SectionTitle } from '@/components/ui/section-title';
import { TaskRow } from '@/features/tasks/components/task-row';
import { dailyBrief, todayTasks } from '@/mocks/data';
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

export default function HomeScreen() {
  const router = useRouter();
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());
  const [tasksExpanded, setTasksExpanded] = useState(false);

  const openTasks = useMemo(
    () => todayTasks.filter((task) => !completedIds.has(task.id)),
    [completedIds],
  );
  const toggleTask = (id: string) => {
    setCompletedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const visibleTasks = tasksExpanded ? openTasks : openTasks.slice(0, 4);
  const remainingTaskCount = Math.max(0, openTasks.length - visibleTasks.length);
  const showTaskToggle = tasksExpanded || remainingTaskCount > 0;

  return (
    <AppScreen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <PageHeader
          action={
            <Pressable
              accessibilityLabel="打开我的"
              onPress={() => router.push('/me')}
              style={styles.avatar}
            >
              <AppIcon color={colors.background} name="person" size={20} />
            </Pressable>
          }
          subtitle="8月18日 · 星期二"
          title="首页"
        />

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
          count={`${openTasks.length} 项`}
          style={styles.homeSectionTitle}
          title="今天要做"
        />
        {visibleTasks.map((task) => (
          <TaskRow
            key={task.id}
            onOpen={() => router.push({ pathname: '/tasks/[id]', params: { id: task.id } })}
            onToggle={() => toggleTask(task.id)}
            task={task}
          />
        ))}
        {showTaskToggle ? (
          <Pressable
            accessibilityLabel={tasksExpanded ? '收起今日任务' : `展开剩余 ${remainingTaskCount} 项任务`}
            accessibilityRole="button"
            accessibilityState={{ expanded: tasksExpanded }}
            onPress={() => setTasksExpanded((current) => !current)}
            style={({ pressed }) => [styles.taskToggle, pressed && styles.taskTogglePressed]}
          >
            <Text style={styles.taskToggleText}>
              {tasksExpanded ? '收起' : `展开剩余 ${remainingTaskCount} 项`}
            </Text>
            <AppIcon
              color={colors.primaryStrong}
              name={tasksExpanded ? 'chevron-up' : 'chevron-down'}
              size={16}
            />
          </Pressable>
        ) : null}

        <SectionTitle style={styles.homeSectionTitle} title="今日提醒" />
        <Pressable
          accessibilityHint="进入日历查看今天的完整安排"
          accessibilityLabel="打开日历查看今日提醒"
          accessibilityRole="button"
          onPress={() => router.push('/calendar')}
          style={({ pressed }) => [styles.brief, pressed && styles.briefPressed]}
        >
          <View style={styles.briefIcon}>
            <AppIcon color={colors.primaryStrong} name="sparkles" size={19} />
          </View>
          <View style={styles.briefCopy}>
            <Text style={styles.briefTitle}>{dailyBrief.title}</Text>
            <Text style={styles.briefSummary}>{dailyBrief.summary}</Text>
            <Text style={styles.briefSource}>{dailyBrief.source}</Text>
          </View>
          <View style={styles.briefChevron}>
            <AppIcon color={colors.textTertiary} name="chevron-forward" size={18} />
          </View>
        </Pressable>
      </ScrollView>
      <AiFab count={3} />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 92,
  },
  avatar: {
    width: 40,
    height: 40,
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
  brief: {
    minHeight: 116,
    paddingTop: 16,
    paddingRight: 14,
    paddingBottom: 16,
    paddingLeft: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: radius.lg,
    backgroundColor: '#F1F8F4',
  },
  briefPressed: {
    backgroundColor: '#E9F4EE',
  },
  briefIcon: {
    width: 36,
    height: 36,
    marginRight: 12,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DDF6E9',
  },
  briefCopy: {
    flex: 1,
  },
  briefChevron: {
    width: 24,
    alignSelf: 'stretch',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  briefTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
  },
  briefSummary: {
    marginTop: 4,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 13,
    lineHeight: 20,
  },
  briefSource: {
    marginTop: 6,
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
  },
});
