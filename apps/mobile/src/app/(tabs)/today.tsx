import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AiFab } from '@/components/ui/ai-fab';
import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { PageHeader } from '@/components/ui/page-header';
import { SectionTitle } from '@/components/ui/section-title';
import { TaskRow } from '@/features/tasks/components/task-row';
import { completedTasks, todayTasks } from '@/mocks/data';
import { colors, fontFamily, radius } from '@/theme/tokens';

export default function TodayScreen() {
  const router = useRouter();
  const [completedIds, setCompletedIds] = useState<Set<string>>(
    new Set(completedTasks.map((task) => task.id)),
  );

  const openTasks = useMemo(
    () => todayTasks.filter((task) => !completedIds.has(task.id)),
    [completedIds],
  );
  const doneTasks = useMemo(
    () => [...todayTasks, ...completedTasks].filter((task) => completedIds.has(task.id)),
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

  const visibleProgress = Math.min(8, 3 + Math.max(0, doneTasks.length - completedTasks.length));

  return (
    <AppScreen>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
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
          subtitle="6月18日 · 星期三"
          title="今天"
        />
        <View style={styles.progressCard}>
          <View style={styles.progressCopy}>
            <Text style={styles.progressLabel}>今日进度</Text>
            <Text style={styles.progressValue}>{visibleProgress} / 8 已完成</Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${(visibleProgress / 8) * 100}%` }]} />
          </View>
        </View>

        <SectionTitle count={`${openTasks.length} 项`} title="今天" />
        {openTasks.map((task) => (
          <TaskRow
            key={task.id}
            onOpen={() => router.push({ pathname: '/tasks/[id]', params: { id: task.id } })}
            onToggle={() => toggleTask(task.id)}
            task={task}
          />
        ))}

        <SectionTitle count={`${doneTasks.length} 项`} title="已完成" />
        {doneTasks.map((task) => (
          <TaskRow
            completed
            key={task.id}
            onOpen={() => router.push({ pathname: '/tasks/[id]', params: { id: task.id } })}
            onToggle={() => toggleTask(task.id)}
            task={task}
          />
        ))}
      </ScrollView>
      <AiFab count={3} />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingBottom: 86,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  progressCard: {
    height: 80,
    marginBottom: 8,
    paddingHorizontal: 20,
    paddingVertical: 17,
    borderRadius: radius.xl,
    backgroundColor: colors.primarySoft,
  },
  progressCopy: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressLabel: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
  },
  progressValue: {
    color: colors.primary,
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  track: {
    height: 8,
    marginTop: 13,
    overflow: 'hidden',
    borderRadius: radius.pill,
    backgroundColor: colors.primaryTrack,
  },
  fill: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
});
