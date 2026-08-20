import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/components/ui/icon';
import type { TaskItem } from '@/features/tasks/model';
import { colors, fontFamily, radius } from '@/theme/tokens';

type TaskRowProps = {
  task: TaskItem;
  completed?: boolean;
  onOpen?: () => void;
  onToggle: () => void;
};

const flagColors = {
  high: colors.danger,
  normal: colors.warning,
  low: colors.textTertiary,
} as const;

export function TaskRow({ task, completed = false, onOpen, onToggle }: TaskRowProps) {
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityLabel={completed ? `恢复任务：${task.title}` : `完成任务：${task.title}`}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: completed }}
        hitSlop={10}
        onPress={onToggle}
        style={[styles.checkbox, completed && styles.checkboxDone]}
      >
        {completed ? <AppIcon color={colors.background} name="checkmark" size={15} /> : null}
      </Pressable>
      <Pressable disabled={!onOpen} onPress={onOpen} style={styles.content}>
        <Text numberOfLines={2} style={[styles.title, completed && styles.titleDone]}>
          {task.title}
        </Text>
        <View style={styles.meta}>
          <View style={[styles.dot, { backgroundColor: task.color }]} />
          <Text style={[styles.metaText, completed && styles.metaDone]}>{task.list}</Text>
          {task.time ? (
            <>
              <Text style={styles.separator}>·</Text>
              <Text style={[styles.metaText, completed && styles.metaDone]}>{task.time}</Text>
            </>
          ) : null}
        </View>
      </Pressable>
      {!completed && task.priority ? (
        <AppIcon color={flagColors[task.priority]} name="flag" size={16} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 77,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.7,
    borderColor: '#C8CFCC',
  },
  checkboxDone: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    color: colors.text,
    fontFamily,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '500',
  },
  titleDone: {
    color: colors.textTertiary,
    textDecorationLine: 'line-through',
  },
  meta: {
    marginTop: 5,
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 7,
    height: 7,
    marginRight: 6,
    borderRadius: radius.pill,
  },
  metaText: {
    color: colors.textTertiary,
    fontFamily,
    fontSize: 12,
    lineHeight: 17,
  },
  metaDone: {
    color: '#B4BAB7',
  },
  separator: {
    marginHorizontal: 5,
    color: colors.textTertiary,
    fontSize: 12,
  },
});
