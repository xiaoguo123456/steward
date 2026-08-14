import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily } from '@/theme/tokens';

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  action?: ReactNode;
};

export function PageHeader({ title, subtitle, action }: PageHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.copy}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  copy: {
    flexShrink: 1,
  },
  title: {
    color: colors.text,
    fontFamily,
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  subtitle: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 13,
    lineHeight: 18,
  },
});
