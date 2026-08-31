import type { ComponentProps } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, fontFamily, radius, typography } from '@/theme/tokens';
import { AppIcon } from './icon';

type AppButtonProps = {
  label: string;
  accessibilityLabel?: string;
  onPress?: () => void;
  disabled?: boolean;
  icon?: ComponentProps<typeof AppIcon>['name'];
  variant?: 'primary' | 'secondary' | 'neutral' | 'text' | 'textMuted' | 'danger';
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function AppButton({
  accessibilityLabel,
  label,
  onPress,
  disabled = false,
  icon,
  variant = 'primary',
  compact = false,
  style,
}: AppButtonProps) {
  const isPrimary = variant === 'primary';
  const isMuted = variant === 'neutral' || variant === 'textMuted';
  const iconColor = disabled
    ? colors.textSecondary
    : isPrimary
      ? colors.background
      : variant === 'danger'
        ? colors.danger
        : isMuted
          ? colors.textSecondary
          : colors.primaryStrong;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
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
          color={iconColor}
          name={icon}
          size={18}
        />
      ) : null}
      <Text
        style={[
          styles.label,
          isPrimary && styles.primaryLabel,
          isMuted && styles.mutedLabel,
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
  neutral: {
    backgroundColor: colors.surfaceSubtle,
  },
  text: {
    backgroundColor: 'transparent',
  },
  textMuted: {
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
  mutedLabel: {
    color: colors.textSecondary,
  },
  dangerLabel: {
    color: colors.danger,
  },
  disabledLabel: {
    color: colors.textSecondary,
  },
});
