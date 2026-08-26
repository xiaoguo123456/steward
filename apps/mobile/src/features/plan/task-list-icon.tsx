import type { TaskList } from '@steward/api-client';
import Airplane01Icon from '@hugeicons/core-free-icons/Airplane01Icon';
import BookOpen01Icon from '@hugeicons/core-free-icons/BookOpen01Icon';
import Briefcase03Icon from '@hugeicons/core-free-icons/Briefcase03Icon';
import BulbIcon from '@hugeicons/core-free-icons/BulbIcon';
import Calendar04Icon from '@hugeicons/core-free-icons/Calendar04Icon';
import Dumbbell01Icon from '@hugeicons/core-free-icons/Dumbbell01Icon';
import HealthIcon from '@hugeicons/core-free-icons/HealthIcon';
import Home03Icon from '@hugeicons/core-free-icons/Home03Icon';
import InboxIcon from '@hugeicons/core-free-icons/InboxIcon';
import ListIcon from '@hugeicons/core-free-icons/ListIcon';
import StarIcon from '@hugeicons/core-free-icons/StarIcon';
import Wallet01Icon from '@hugeicons/core-free-icons/Wallet01Icon';
import { HugeiconsIcon } from '@hugeicons/react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/components/ui/icon';
import {
  TASK_LIST_COLOR_TOKENS,
  TASK_LIST_ICON_OPTIONS,
  resolveTaskListAppearance,
  type TaskListColorToken,
  type TaskListIconId,
} from '@/features/plan/task-list-appearance';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

const appearancePalette: Record<TaskListColorToken, { background: string; foreground: string }> = {
  green: { background: colors.primarySoft, foreground: colors.primaryStrong },
  blue: { background: '#EFF6FF', foreground: '#1D4ED8' },
  orange: { background: '#FFF7ED', foreground: '#B45309' },
  purple: { background: '#F5F3FF', foreground: '#6D28D9' },
  pink: { background: '#FDF2F8', foreground: '#BE185D' },
  gray: { background: colors.surface, foreground: '#4B5563' },
};

const taskListIcons = {
  inbox: InboxIcon,
  work: Briefcase03Icon,
  home: Home03Icon,
  study: BookOpen01Icon,
  health: HealthIcon,
  sport: Dumbbell01Icon,
  finance: Wallet01Icon,
  travel: Airplane01Icon,
  calendar: Calendar04Icon,
  idea: BulbIcon,
  important: StarIcon,
  general: ListIcon,
} satisfies Record<TaskListIconId, React.ComponentProps<typeof HugeiconsIcon>['icon']>;

export function taskListAppearanceColors(color: TaskListColorToken) {
  return appearancePalette[color];
}

export function TaskListAppearanceChip({
  icon,
  color,
  size = 36,
  muted = false,
}: {
  icon: TaskListIconId;
  color: TaskListColorToken;
  size?: number;
  muted?: boolean;
}) {
  const palette = taskListAppearanceColors(color);
  return (
    <View
      style={[
        styles.chip,
        {
          width: size,
          height: size,
          backgroundColor: palette.background,
          opacity: muted ? 0.58 : 1,
        },
      ]}
    >
      <HugeiconsIcon
        color={palette.foreground}
        icon={taskListIcons[icon]}
        size={Math.round(size * 0.53)}
        strokeWidth={1.8}
      />
    </View>
  );
}

export function TaskListIconChip({
  list,
  size = 36,
  muted = false,
}: {
  list: TaskList;
  size?: number;
  muted?: boolean;
}) {
  const appearance = resolveTaskListAppearance(list);
  return <TaskListAppearanceChip {...appearance} muted={muted} size={size} />;
}

export function TaskListAppearancePicker({
  icon,
  color,
  fixedIcon = false,
  onColorChange,
  onIconChange,
}: {
  icon: TaskListIconId;
  color: TaskListColorToken;
  fixedIcon?: boolean;
  onColorChange: (color: TaskListColorToken) => void;
  onIconChange: (icon: TaskListIconId) => void;
}) {
  return (
    <View style={styles.picker}>
      <Text style={styles.label}>颜色</Text>
      <View style={styles.optionRow}>
        {TASK_LIST_COLOR_TOKENS.map((token) => {
          const selected = token === color;
          const palette = taskListAppearanceColors(token);
          return (
            <Pressable
              accessibilityLabel={`${tokenColorLabel[token]}${selected ? '，已选择' : ''}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              key={token}
              onPress={() => onColorChange(token)}
              style={({ pressed }) => [
                styles.colorOption,
                selected && styles.selectedOption,
                pressed && styles.pressed,
              ]}
            >
              <View style={[styles.colorDot, { backgroundColor: palette.foreground }]}>
                {selected ? <AppIcon color="#FFFFFF" name="checkmark" size={15} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      {fixedIcon ? null : (
        <>
          <Text style={[styles.label, styles.iconLabel]}>图标</Text>
          <View style={styles.iconGrid}>
            {TASK_LIST_ICON_OPTIONS.map((option) => {
              const selected = option.id === icon;
              const palette = taskListAppearanceColors(color);
              return (
                <View key={option.id} style={styles.iconCell}>
                  <Pressable
                    accessibilityLabel={`${option.label}${selected ? '，已选择' : ''}`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => onIconChange(option.id)}
                    style={({ pressed }) => [
                      styles.iconOption,
                      selected && { backgroundColor: palette.background },
                      pressed && styles.pressed,
                    ]}
                  >
                    <HugeiconsIcon
                      color={selected ? palette.foreground : colors.textSecondary}
                      icon={taskListIcons[option.id]}
                      size={20}
                      strokeWidth={1.8}
                    />
                  </Pressable>
                </View>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}

const tokenColorLabel: Record<TaskListColorToken, string> = {
  green: '绿色',
  blue: '蓝色',
  orange: '橙色',
  purple: '紫色',
  pink: '粉色',
  gray: '灰色',
};

const styles = StyleSheet.create({
  chip: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  picker: {
    marginTop: 12,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  label: {
    color: colors.text,
    fontFamily,
    ...typography.meta,
    fontWeight: '600',
  },
  optionRow: {
    marginTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  colorOption: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  selectedOption: {
    backgroundColor: colors.surface,
  },
  colorDot: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  iconLabel: {
    marginTop: 10,
  },
  iconGrid: {
    marginTop: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 6,
  },
  iconCell: {
    width: '16.666666%',
    alignItems: 'center',
  },
  iconOption: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  pressed: {
    opacity: 0.6,
  },
});
