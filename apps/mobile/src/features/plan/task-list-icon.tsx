import type { TaskList } from '@steward/api-client';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppIcon, type AppIconName } from '@/components/ui/icon';
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
  inbox: 'inbox',
  work: 'briefcase-outline',
  home: 'home-outline',
  study: 'book',
  health: 'heart-outline',
  sport: 'fitness-outline',
  finance: 'wallet-outline',
  travel: 'airplane-outline',
  calendar: 'calendar-outline',
  idea: 'bulb-outline',
  important: 'star',
  general: 'list-outline',
} satisfies Record<TaskListIconId, AppIconName>;

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
      <AppIcon
        color={palette.foreground}
        name={taskListIcons[icon]}
        size={Math.round(size * 0.53)}
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
                    <AppIcon
                      color={selected ? palette.foreground : colors.textSecondary}
                      name={taskListIcons[option.id]}
                      size={20}
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
