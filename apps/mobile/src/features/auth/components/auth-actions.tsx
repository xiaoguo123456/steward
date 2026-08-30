import type { PropsWithChildren } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { colors, fontFamily, radius } from '@/theme/tokens';

type PrimaryButtonProps = PropsWithChildren<{
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
}>;

export function PrimaryButton({
  accessibilityHint,
  children,
  onPress,
  disabled = false,
  loading = false,
}: PrimaryButtonProps) {
  const unavailable = disabled || loading;

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: unavailable }}
      disabled={unavailable}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        disabled && !loading && styles.disabled,
        pressed && !unavailable && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.background} size="small" />
      ) : (
        <Text style={styles.text}>{children}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    paddingHorizontal: 20,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  pressed: {
    opacity: 0.86,
  },
  disabled: {
    backgroundColor: colors.borderStrong,
  },
  text: {
    color: colors.background,
    fontFamily,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '600',
  },
});
