import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { AppIcon } from '@/components/ui/icon';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

/** 任务列表末尾的就地新增入口，不与全局 Capture 主按钮争夺层级。 */
export function AddTaskRow({
  onPress,
  style,
}: {
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityLabel="添加任务"
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, style, pressed && styles.pressed]}
    >
      <AppIcon color={colors.primaryStrong} name="add-outline" size={20} />
      <Text style={styles.label}>添加任务</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 52,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: radius.md,
  },
  pressed: {
    backgroundColor: colors.primarySoft,
  },
  label: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.bodyStrong,
  },
});
