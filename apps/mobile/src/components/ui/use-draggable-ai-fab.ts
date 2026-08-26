import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import type {
  GestureUpdateEvent,
  PanGestureHandlerEventPayload,
} from 'react-native-gesture-handler';
import {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  getAiFabDockPosition,
  scheduleAiFabDockPositionSave,
  subscribeAiFabDockPosition,
  type AiFabDockSide,
} from './ai-fab-position-store';

export const AI_FAB_SIZE = 58;

const HORIZONTAL_MARGIN = 16;
const TOP_MARGIN = 12;
const BOTTOM_MARGIN = 18;
const PAN_ACTIVATION_DISTANCE = 8;
const SNAP_DURATION = 200;

type FabLayout = {
  width: number;
  height: number;
};

type UseDraggableAiFabOptions = {
  bottomInset?: number;
  onPress: () => void;
};

export function useDraggableAiFab({ bottomInset = 0, onPress }: UseDraggableAiFabOptions) {
  const reducedMotion = useReducedMotion();
  const storedPosition = useSyncExternalStore(
    subscribeAiFabDockPosition,
    getAiFabDockPosition,
    getAiFabDockPosition,
  );
  const [layout, setLayout] = useState<FabLayout | null>(null);
  const blockPressRef = useRef(false);
  const unblockPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const dragStartX = useSharedValue(0);
  const dragStartY = useSharedValue(0);
  const leftBound = useSharedValue(HORIZONTAL_MARGIN);
  const rightBound = useSharedValue(HORIZONTAL_MARGIN);
  const topBound = useSharedValue(TOP_MARGIN);
  const bottomBound = useSharedValue(TOP_MARGIN);
  const horizontalMiddle = useSharedValue(0);
  const dragScale = useSharedValue(1);
  const dragActive = useSharedValue(false);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setLayout((current) => (
      current?.width === width && current.height === height ? current : { width, height }
    ));
  }, []);

  const blockPress = useCallback(() => {
    if (unblockPressTimerRef.current) {
      clearTimeout(unblockPressTimerRef.current);
    }
    blockPressRef.current = true;
  }, []);

  const schedulePressUnblock = useCallback(() => {
    unblockPressTimerRef.current = setTimeout(() => {
      blockPressRef.current = false;
      unblockPressTimerRef.current = null;
    }, 140);
  }, []);

  const handlePress = useCallback(() => {
    if (!blockPressRef.current) {
      onPress();
    }
  }, [onPress]);

  useEffect(() => () => {
    if (unblockPressTimerRef.current) {
      clearTimeout(unblockPressTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!layout) {
      return;
    }

    const nextRightBound = Math.max(
      HORIZONTAL_MARGIN,
      layout.width - AI_FAB_SIZE - HORIZONTAL_MARGIN,
    );
    const nextBottomBound = Math.max(
      TOP_MARGIN,
      layout.height - AI_FAB_SIZE - BOTTOM_MARGIN - bottomInset,
    );
    const verticalRange = nextBottomBound - TOP_MARGIN;

    leftBound.value = HORIZONTAL_MARGIN;
    rightBound.value = nextRightBound;
    topBound.value = TOP_MARGIN;
    bottomBound.value = nextBottomBound;
    horizontalMiddle.value = layout.width / 2;
    translateX.value = storedPosition.side === 'left' ? HORIZONTAL_MARGIN : nextRightBound;
    translateY.value = TOP_MARGIN + verticalRange * storedPosition.verticalRatio;
  }, [
    bottomBound,
    bottomInset,
    horizontalMiddle,
    layout,
    leftBound,
    rightBound,
    storedPosition,
    topBound,
    translateX,
    translateY,
  ]);

  /* eslint-disable react-hooks/immutability, react-hooks/refs --
   * Reanimated SharedValue 必须在 UI 线程手势 worklet 中原地更新，
   * React Hooks 规则会将其误判为渲染期的普通 ref 写入。
   */
  const handlePanStart = useCallback(() => {
    'worklet';
    dragActive.value = true;
    dragStartX.value = translateX.value;
    dragStartY.value = translateY.value;
    dragScale.value = reducedMotion
      ? 1.04
      : withTiming(1.04, { duration: 120, easing: Easing.out(Easing.cubic) });
    runOnJS(blockPress)();
  }, [
    blockPress,
    dragActive,
    dragScale,
    dragStartX,
    dragStartY,
    reducedMotion,
    translateX,
    translateY,
  ]);

  const handlePanUpdate = useCallback((event: GestureUpdateEvent<PanGestureHandlerEventPayload>) => {
    'worklet';
    translateX.value = Math.min(
      rightBound.value,
      Math.max(leftBound.value, dragStartX.value + event.translationX),
    );
    translateY.value = Math.min(
      bottomBound.value,
      Math.max(topBound.value, dragStartY.value + event.translationY),
    );
  }, [
    bottomBound,
    dragStartX,
    dragStartY,
    leftBound,
    rightBound,
    topBound,
    translateX,
    translateY,
  ]);

  const handlePanRelease = useCallback(() => {
    'worklet';
    if (!dragActive.value) {
      return;
    }

    dragActive.value = false;
    const side: AiFabDockSide = translateX.value + AI_FAB_SIZE / 2 < horizontalMiddle.value
      ? 'left'
      : 'right';
    const targetX = side === 'left' ? leftBound.value : rightBound.value;
    const targetY = Math.min(bottomBound.value, Math.max(topBound.value, translateY.value));
    const verticalRange = bottomBound.value - topBound.value;
    const verticalRatio = verticalRange > 0 ? (targetY - topBound.value) / verticalRange : 0;

    translateY.value = targetY;
    dragScale.value = reducedMotion
      ? 1
      : withTiming(1, { duration: 160, easing: Easing.out(Easing.cubic) });
    runOnJS(schedulePressUnblock)();

    if (reducedMotion) {
      translateX.value = targetX;
      runOnJS(scheduleAiFabDockPositionSave)(side, verticalRatio, 0);
      return;
    }

    runOnJS(scheduleAiFabDockPositionSave)(side, verticalRatio, SNAP_DURATION);
    translateX.value = withTiming(
      targetX,
      {
        duration: SNAP_DURATION,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
      },
    );
  }, [
    bottomBound,
    dragActive,
    dragScale,
    horizontalMiddle,
    leftBound,
    reducedMotion,
    rightBound,
    schedulePressUnblock,
    topBound,
    translateX,
    translateY,
  ]);

  const panGesture = useMemo(
    () => Gesture.Pan()
      .minDistance(PAN_ACTIVATION_DISTANCE)
      .shouldCancelWhenOutside(false)
      .onStart(handlePanStart)
      .onUpdate(handlePanUpdate)
      .onEnd(handlePanRelease)
      .onFinalize(handlePanRelease)
      .onTouchesUp(handlePanRelease)
      .onTouchesCancelled(handlePanRelease),
    [handlePanRelease, handlePanStart, handlePanUpdate],
  );
  /* eslint-enable react-hooks/immutability, react-hooks/refs */

  const animatedPosition = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: dragScale.value },
    ],
  }));

  return {
    animatedPosition,
    handleLayout,
    handlePress,
    layoutReady: layout !== null,
    panGesture,
  };
}
