import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, typography } from '@/theme/tokens';
import { AppIcon } from './icon';

type NavHeaderProps = {
  title?: string;
  right?: ReactNode;
  onBack?: () => void;
  showBack?: boolean;
};

export function NavHeader({ title, right, onBack, showBack = true }: NavHeaderProps) {
  const router = useRouter();

  return (
    <View style={styles.header}>
      {showBack ? (
        <Pressable
          accessibilityLabel="返回"
          accessibilityRole="button"
          hitSlop={12}
          onPress={onBack ?? (() => router.back())}
          style={styles.side}
        >
          <AppIcon name="chevron-back" size={24} />
        </Pressable>
      ) : <View style={styles.side} />}
      <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
        {title}
      </Text>
      <View style={[styles.side, styles.right]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  side: {
    width: 54,
    height: 44,
    justifyContent: 'center',
  },
  right: {
    alignItems: 'flex-end',
  },
  title: {
    flex: 1,
    color: colors.text,
    fontFamily,
    ...typography.section,
    textAlign: 'center',
  },
});
