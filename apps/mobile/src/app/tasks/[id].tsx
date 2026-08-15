import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import {
  completedTasks,
  todayTasks,
  tomorrowTasks,
  unscheduledTasks,
} from '@/mocks/data';
import { colors, fontFamily, radius } from '@/theme/tokens';

const detailRows = [
  { label: '所属清单', value: '工作', color: colors.text },
  { label: '截止时间', value: '今天 10:00', color: colors.text },
  { label: '优先级', value: '高', color: colors.danger },
  { label: '标签', value: '工作', color: colors.blue },
];

export default function TaskDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [doneSubtasks, setDoneSubtasks] = useState(new Set(['book-room']));
  const task = useMemo(
    () =>
      [...todayTasks, ...tomorrowTasks, ...unscheduledTasks, ...completedTasks].find(
        (item) => item.id === id,
      ),
    [id],
  );

  const toggleSubtask = (subtaskId: string) => {
    setDoneSubtasks((current) => {
      const next = new Set(current);
      if (next.has(subtaskId)) next.delete(subtaskId);
      else next.add(subtaskId);
      return next;
    });
  };

  return (
    <AppScreen>
      <NavHeader
        right={
          <Pressable hitSlop={12}>
            <AppIcon name="ellipsis-horizontal" size={22} />
          </Pressable>
        }
        title="任务详情"
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.taskTitle}>{task?.title ?? '完成产品需求评审文档'}</Text>
        <View style={styles.detailCard}>
          {detailRows.map((row) => (
            <View key={row.label} style={styles.detailRow}>
              <Text style={styles.label}>{row.label}</Text>
              <Text style={[styles.value, { color: row.color }]}>{row.value}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>备注</Text>
        <Text style={styles.note}>
          重点确认首页改版方案和任务流优化细节，会后同步给团队。
        </Text>

        <Text style={styles.sectionTitle}>子任务</Text>
        <SubtaskRow
          completed={doneSubtasks.has('review')}
          onPress={() => toggleSubtask('review')}
          title="整理评审意见"
        />
        <SubtaskRow
          completed={doneSubtasks.has('book-room')}
          onPress={() => toggleSubtask('book-room')}
          title="预约会议室"
        />

        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.deleteButton, pressed && styles.deletePressed]}
        >
          <Text style={styles.deleteText}>删除任务</Text>
        </Pressable>
      </ScrollView>
    </AppScreen>
  );
}

function SubtaskRow({
  completed,
  onPress,
  title,
}: {
  completed: boolean;
  onPress: () => void;
  title: string;
}) {
  return (
    <Pressable onPress={onPress} style={styles.subtaskRow}>
      <View style={[styles.checkbox, completed && styles.checkboxDone]}>
        {completed ? <AppIcon color={colors.background} name="checkmark" size={14} /> : null}
      </View>
      <Text style={[styles.subtaskTitle, completed && styles.subtaskDone]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  taskTitle: {
    marginTop: -4,
    marginBottom: 16,
    color: colors.text,
    fontFamily,
    fontSize: 22,
    lineHeight: 30,
    fontWeight: '700',
    letterSpacing: -0.25,
  },
  detailCard: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  },
  detailRow: {
    height: 47,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 14,
  },
  value: {
    fontFamily,
    fontSize: 14,
    fontWeight: '500',
  },
  sectionTitle: {
    marginTop: 20,
    marginBottom: 12,
    color: colors.text,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  note: {
    color: colors.textSecondary,
    fontFamily,
    fontSize: 14,
    lineHeight: 24,
  },
  subtaskRow: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  checkbox: {
    width: 19,
    height: 19,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: '#C8CFCC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxDone: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  subtaskTitle: {
    color: colors.text,
    fontFamily,
    fontSize: 14,
    lineHeight: 20,
  },
  subtaskDone: {
    color: colors.textTertiary,
    textDecorationLine: 'line-through',
  },
  deleteButton: {
    height: 49,
    marginTop: 16,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deletePressed: {
    backgroundColor: '#FFF1F4',
  },
  deleteText: {
    color: colors.danger,
    fontFamily,
    fontSize: 15,
    fontWeight: '600',
  },
});
