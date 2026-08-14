import type { PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, fontFamily, radius } from '@/theme/tokens';

type PrimaryButtonProps = PropsWithChildren<{
  onPress: () => void;
}>;

export function PrimaryButton({ children, onPress }: PrimaryButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Text style={styles.text}>{children}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  pressed: {
    opacity: 0.86,
  },
  text: {
    color: colors.background,
    fontFamily,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '600',
  },
});
