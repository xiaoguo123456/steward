import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, radius } from '@/theme/tokens';
import { AiAssistantAvatar } from './ai-assistant-avatar';

type AiFabProps = {
  count?: number;
};

export function AiFab({ count = 0 }: AiFabProps) {
  const router = useRouter();
  const badgeText = count > 9 ? '9+' : count.toString();
  const accessibilityLabel = count > 0
    ? `打开 AI 管家，${count} 项待处理`
    : '打开 AI 管家';

  return (
    <Pressable
      accessibilityHint="查看 AI 的待答问题和处理结果"
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={6}
      onPress={() => router.push('/ai')}
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
    >
      <AiAssistantAvatar size={58} />
      {count > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badgeText}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    position: 'absolute',
    right: 16,
    bottom: 18,
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  pressed: {
    opacity: 0.9,
    transform: [{ scale: 0.94 }],
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -4,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 5,
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
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
  },
});
