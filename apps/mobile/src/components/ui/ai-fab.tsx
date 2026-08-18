import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, radius, shadow } from '@/theme/tokens';
import { AppIcon } from './icon';

type AiFabProps = {
  count?: number;
};

export function AiFab({ count = 0 }: AiFabProps) {
  const router = useRouter();

  return (
    <Pressable
      accessibilityLabel="打开 AI 助手"
      accessibilityRole="button"
      onPress={() => router.push('/ai')}
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
    >
      <LinearGradient colors={[colors.aiStart, colors.aiEnd]} style={styles.gradient}>
        <AppIcon color={colors.background} name="sparkles" size={22} />
      </LinearGradient>
      {count > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    position: 'absolute',
    right: 20,
    bottom: 18,
    width: 54,
    height: 54,
    borderRadius: radius.pill,
    zIndex: 20,
    ...shadow,
  },
  gradient: {
    width: 54,
    height: 54,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.84,
    transform: [{ scale: 0.96 }],
  },
  badge: {
    position: 'absolute',
    top: -5,
    right: -2,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 4,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
    borderWidth: 2,
    borderColor: colors.background,
  },
  badgeText: {
    color: colors.background,
    fontFamily,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
  },
});
