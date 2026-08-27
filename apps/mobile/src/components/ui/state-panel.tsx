import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, radius, typography } from '@/theme/tokens';
import { AppButton } from './app-button';
import { AppIcon } from './icon';

type StatePanelProps = {
  title: string;
  message: string;
  icon?: ComponentProps<typeof AppIcon>['name'];
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  compact?: boolean;
};

export function StatePanel({
  title,
  message,
  icon = 'information-circle-outline',
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary,
  compact = false,
}: StatePanelProps) {
  return (
    <View style={[styles.panel, compact && styles.panelCompact]}>
      <View style={[styles.icon, compact && styles.iconCompact]}>
        <AppIcon color={colors.primaryStrong} name={icon} size={22} />
      </View>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      <Text style={[styles.message, compact && styles.messageCompact]}>{message}</Text>
      {actionLabel ? (
        <AppButton
          compact
          label={actionLabel}
          onPress={onAction}
          style={[styles.action, compact && styles.actionCompact]}
        />
      ) : null}
      {secondaryLabel ? (
        <AppButton compact label={secondaryLabel} onPress={onSecondary} variant="text" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    paddingHorizontal: 24,
    paddingVertical: 40,
    alignItems: 'center',
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceSubtle,
  },
  panelCompact: {
    paddingVertical: 24,
  },
  icon: {
    width: 44,
    height: 44,
    marginBottom: 14,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  iconCompact: {
    width: 40,
    height: 40,
    marginBottom: 10,
  },
  title: {
    color: colors.text,
    fontFamily,
    ...typography.section,
    textAlign: 'center',
  },
  messageCompact: {
    marginTop: 4,
  },
  message: {
    maxWidth: 280,
    marginTop: 7,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    textAlign: 'center',
  },
  action: {
    minWidth: 132,
    marginTop: 20,
  },
  actionCompact: {
    marginTop: 14,
  },
});
