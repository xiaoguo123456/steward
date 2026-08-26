import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';

import { colors, fontFamily, radius } from '@/theme/tokens';
import { AiAssistantAvatar } from './ai-assistant-avatar';
import { AI_FAB_SIZE, useDraggableAiFab } from './use-draggable-ai-fab';

type AiFabProps = {
  bottomInset?: number;
  count?: number;
};

export const AI_FAB_TAB_BAR_INSET = 76;

export function AiFab({ bottomInset = 0, count = 0 }: AiFabProps) {
  const router = useRouter();
  const openAssistant = useCallback(() => router.push('/ai'), [router]);
  const {
    animatedPosition,
    handleLayout,
    handlePress,
    layoutReady,
    panGesture,
  } = useDraggableAiFab({ bottomInset, onPress: openAssistant });
  const badgeText = count > 9 ? '9+' : count.toString();
  const accessibilityLabel = count > 0
    ? `打开 AI 管家，${count} 项待处理`
    : '打开 AI 管家';

  return (
    <View
      onLayout={handleLayout}
      pointerEvents="box-none"
      style={styles.dragArea}
    >
      <GestureDetector gesture={panGesture}>
        <Animated.View
          style={[styles.positioner, !layoutReady && styles.positionerHidden, animatedPosition]}
        >
          <Pressable
            accessibilityHint="轻点查看 AI 的待处理事项，拖动可调整入口位置"
            accessibilityLabel={accessibilityLabel}
            accessibilityRole="button"
            hitSlop={6}
            onPress={handlePress}
            style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
            testID="ai-assistant-fab"
          >
            <AiAssistantAvatar size={AI_FAB_SIZE} />
            {count > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{badgeText}</Text>
              </View>
            ) : null}
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  dragArea: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 20,
  },
  positioner: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: AI_FAB_SIZE,
    height: AI_FAB_SIZE,
  },
  positionerHidden: {
    opacity: 0,
  },
  pressable: {
    width: AI_FAB_SIZE,
    height: AI_FAB_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.86,
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
