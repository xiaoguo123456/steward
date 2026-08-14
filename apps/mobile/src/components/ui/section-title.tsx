import { StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily } from '@/theme/tokens';

type SectionTitleProps = {
  title: string;
  count?: string;
};

export function SectionTitle({ title, count }: SectionTitleProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title}</Text>
      {count ? <Text style={styles.count}>{count}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: colors.text,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  count: {
    color: colors.textTertiary,
    fontFamily,
    fontSize: 12,
    lineHeight: 18,
  },
});
