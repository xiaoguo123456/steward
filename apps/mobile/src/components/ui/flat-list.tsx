import type { ComponentProps, PropsWithChildren, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, radius, typography } from '@/theme/tokens';
import { AppIcon } from './icon';

export function FlatListGroup({ children }: PropsWithChildren) {
  return <View style={styles.group}>{children}</View>;
}

type FlatListRowProps = {
  title: string;
  subtitle?: string;
  icon?: ComponentProps<typeof AppIcon>['name'];
  trailing?: ReactNode;
  showChevron?: boolean;
  showDivider?: boolean;
  onPress?: () => void;
};

export function FlatListRow({
  title,
  subtitle,
  icon,
  trailing,
  showChevron,
  showDivider = true,
  onPress,
}: FlatListRowProps) {
  const shouldShowChevron = showChevron ?? Boolean(onPress);
  const content = (
    <>
      {icon ? (
        <View style={styles.icon}>
          <AppIcon color={colors.primaryStrong} name={icon} size={19} />
        </View>
      ) : null}
      <View style={[styles.copy, showDivider && styles.divider]}>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {trailing}
        {shouldShowChevron ? (
          <AppIcon color={colors.borderStrong} name="chevron-forward" size={17} />
        ) : null}
      </View>
    </>
  );

  if (!onPress) {
    return <View style={styles.row}>{content}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: {
    overflow: 'hidden',
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  row: {
    minHeight: 60,
    paddingLeft: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pressed: {
    backgroundColor: colors.primarySoft,
  },
  icon: {
    width: 34,
    height: 34,
    marginRight: 12,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  copy: {
    minHeight: 60,
    flex: 1,
    paddingRight: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  titleBlock: {
    flex: 1,
    paddingVertical: 10,
  },
  title: {
    color: colors.text,
    fontFamily,
    ...typography.body,
  },
  subtitle: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
});
