import type { StyleProp, ViewStyle } from 'react-native';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, fontFamily, radius, typography } from '@/theme/tokens';

type FilterChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  longPressActionLabel?: string;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

/**
 * 列表内容的统一筛选胶囊。
 *
 * 它只表达当前筛选范围，不承担主操作、数量徽标或业务状态标签。
 */
export function FilterChip({
  accessibilityHint,
  accessibilityLabel,
  label,
  longPressActionLabel,
  onLongPress,
  onPress,
  selected,
  style,
}: FilterChipProps) {
  const accessibilityActions =
    onLongPress && longPressActionLabel
      ? [{ name: 'open', label: longPressActionLabel }]
      : undefined;

  return (
    <Pressable
      accessibilityActions={accessibilityActions}
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      delayLongPress={450}
      hitSlop={5}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'open') onLongPress?.();
      }}
      onLongPress={onLongPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.selected,
        pressed && styles.pressed,
        style,
      ]}
    >
      <Text numberOfLines={1} style={[styles.label, selected && styles.labelSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 34,
    maxWidth: 160,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
  },
  selected: {
    backgroundColor: colors.primarySoft,
  },
  label: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  labelSelected: {
    color: colors.primaryStrong,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.6,
  },
});
