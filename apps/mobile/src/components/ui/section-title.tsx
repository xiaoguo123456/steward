import type { StyleProp, ViewStyle } from 'react-native';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, radius, typography } from '@/theme/tokens';

type SectionTitleProps = {
  title: string;
  count?: string;
  style?: StyleProp<ViewStyle>;
};

export function SectionTitle({ title, count, style }: SectionTitleProps) {
  return (
    <View style={[styles.row, style]}>
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      {count ? (
        <View style={styles.countBadge}>
          <Text style={styles.count}>{count}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  countBadge: {
    minWidth: 40,
    height: 24,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  count: {
    color: colors.primaryStrong,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700',
  },
});
