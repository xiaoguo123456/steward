import type { ComponentProps, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  AppIcon,
  SportModeIcon,
  type SportModeIconName,
} from '@/components/ui/icon';
import { colors, fontFamily, radius } from '@/theme/tokens';

import { workoutAccent } from '../workout-content';

type PrimaryButtonProps = {
  label: string;
  onPress: () => void;
  icon?: ComponentProps<typeof AppIcon>['name'];
  disabled?: boolean;
  tone?: 'primary' | 'neutral';
};

export function WorkoutPrimaryButton({
  label,
  onPress,
  icon,
  disabled = false,
  tone = 'primary',
}: PrimaryButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        tone === 'neutral' && styles.neutralButton,
        disabled && styles.primaryButtonDisabled,
        pressed && !disabled && styles.primaryButtonPressed,
      ]}
    >
      {icon ? (
        <AppIcon
          color={tone === 'primary' ? colors.background : workoutAccent.ink}
          name={icon}
          size={19}
        />
      ) : null}
      <Text style={[styles.primaryButtonText, tone === 'neutral' && styles.neutralButtonText]}>
        {label}
      </Text>
    </Pressable>
  );
}

type SectionTitleProps = {
  title: string;
  aside?: string;
  onAsidePress?: () => void;
};

export function WorkoutSectionTitle({ title, aside, onAsidePress }: SectionTitleProps) {
  return (
    <View style={styles.sectionHeader}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        {title}
      </Text>
      {aside && onAsidePress ? (
        <Pressable
          accessibilityLabel={aside}
          accessibilityRole="button"
          hitSlop={8}
          onPress={onAsidePress}
          style={({ pressed }) => pressed && styles.textActionPressed}
        >
          <Text style={styles.sectionAction}>{aside}</Text>
        </Pressable>
      ) : aside ? (
        <Text style={styles.sectionMeta}>{aside}</Text>
      ) : null}
    </View>
  );
}

export function WorkoutIconTile({
  mode,
  selected = false,
  size = 44,
}: {
  mode: SportModeIconName;
  selected?: boolean;
  size?: number;
}) {
  return (
    <View
      style={[
        styles.iconTile,
        { width: size, height: size },
        selected && styles.iconTileSelected,
      ]}
    >
      <SportModeIcon
        color={selected ? colors.background : colors.primaryStrong}
        mode={mode}
        size={Math.round(size * 0.46)}
      />
    </View>
  );
}

export function WorkoutMetric({
  value,
  label,
  emphasized = false,
}: {
  value: string;
  label: string;
  emphasized?: boolean;
}) {
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricValue, emphasized && styles.metricValueEmphasized]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

export function WorkoutDivider() {
  return <View style={styles.divider} />;
}

export function WorkoutNotice({
  icon,
  children,
  tone = 'mint',
}: {
  icon: ComponentProps<typeof AppIcon>['name'];
  children: ReactNode;
  tone?: 'mint' | 'neutral' | 'warning';
}) {
  const backgroundColor =
    tone === 'warning'
      ? workoutAccent.coralSoft
      : tone === 'neutral'
        ? colors.surfaceSubtle
        : colors.primarySoft;
  const iconColor = tone === 'warning' ? workoutAccent.coral : colors.primaryStrong;

  return (
    <View style={[styles.notice, { backgroundColor }]}>
      <AppIcon color={iconColor} name={icon} size={18} />
      <Text style={styles.noticeText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  primaryButton: {
    minHeight: 54,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  neutralButton: {
    backgroundColor: colors.surface,
  },
  primaryButtonDisabled: {
    backgroundColor: '#B9C4BF',
  },
  primaryButtonPressed: {
    opacity: 0.76,
    transform: [{ scale: 0.99 }],
  },
  primaryButtonText: {
    color: colors.background,
    fontFamily,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '700',
  },
  neutralButtonText: {
    color: workoutAccent.ink,
  },
  sectionHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '600',
  },
  sectionAction: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
  },
  sectionMeta: {
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  textActionPressed: {
    opacity: 0.55,
  },
  iconTile: {
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  iconTileSelected: {
    backgroundColor: colors.primary,
  },
  metric: {
    flex: 1,
    alignItems: 'center',
  },
  metricValue: {
    color: workoutAccent.ink,
    fontFamily,
    fontSize: 22,
    lineHeight: 29,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  metricValueEmphasized: {
    color: colors.primaryStrong,
  },
  metricLabel: {
    marginTop: 3,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: workoutAccent.hairline,
  },
  notice: {
    minHeight: 48,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: radius.md,
  },
  noticeText: {
    flex: 1,
    color: workoutAccent.muted,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
  },
});
