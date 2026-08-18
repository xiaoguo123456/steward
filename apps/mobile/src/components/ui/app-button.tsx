import type { ComponentProps } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, fontFamily, radius, typography } from '@/theme/tokens';
import { AppIcon } from './icon';

type AppButtonProps = {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  icon?: ComponentProps<typeof AppIcon>['name'];
  variant?: 'primary' | 'secondary' | 'text' | 'danger';
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function AppButton({
  label,
  onPress,
  disabled = false,
  icon,
  variant = 'primary',
  compact = false,
  style,
}: AppButtonProps) {
  const isPrimary = variant === 'primary';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        compact && styles.compact,
        styles[variant],
        disabled && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {icon ? (
        <AppIcon
          color={isPrimary ? colors.background : variant === 'danger' ? colors.danger : colors.primaryStrong}
          name={icon}
          size={18}
        />
      ) : null}
      <Text
        style={[
          styles.label,
          isPrimary && styles.primaryLabel,
          variant === 'danger' && styles.dangerLabel,
          disabled && styles.disabledLabel,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    paddingHorizontal: 20,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  compact: {
    minHeight: 44,
    paddingHorizontal: 16,
  },
  primary: {
    backgroundColor: colors.primary,
  },
  secondary: {
    backgroundColor: colors.primarySoft,
  },
  text: {
    backgroundColor: 'transparent',
  },
  danger: {
    backgroundColor: colors.dangerSoft,
  },
  pressed: {
    opacity: 0.84,
    transform: [{ scale: 0.985 }],
  },
  disabled: {
    backgroundColor: colors.surface,
  },
  label: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  primaryLabel: {
    color: colors.background,
  },
  dangerLabel: {
    color: colors.danger,
  },
  disabledLabel: {
    color: colors.textSecondary,
  },
});
