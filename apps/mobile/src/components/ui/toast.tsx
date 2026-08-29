import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fontFamily, radius, typography } from '@/theme/tokens';

type ToastContextValue = {
  showToast: (message: string, options?: ToastOptions) => void;
};

type ToastOptions = {
  actionLabel?: string;
  durationMs?: number;
  onAction?: () => void | Promise<void>;
};

type ToastState = ToastOptions & {
  id: number;
  message: string;
};

const ToastContext = createContext<ToastContextValue | null>(null);

/** 在路由和底部面板之上提供短暂、非阻塞的操作反馈。 */
export function ToastProvider({ children }: PropsWithChildren) {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [toast, setToast] = useState<ToastState | null>(null);
  const [opacity] = useState(() => new Animated.Value(0));
  const [translateY] = useState(() => new Animated.Value(8));
  const nextId = useRef(0);

  const showToast = useCallback((message: string, options: ToastOptions = {}) => {
    nextId.current += 1;
    setToast({ id: nextId.current, message, ...options });
  }, []);

  useEffect(() => {
    if (!toast) return;

    opacity.stopAnimation();
    translateY.stopAnimation();
    opacity.setValue(reducedMotion ? 1 : 0);
    translateY.setValue(reducedMotion ? 0 : 8);
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: reducedMotion ? 0 : 180,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: reducedMotion ? 0 : 180,
        useNativeDriver: true,
      }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: reducedMotion ? 0 : 160,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setToast((current) => current?.id === toast.id ? null : current);
      });
    }, toast.durationMs ?? 2400);

    return () => clearTimeout(timer);
  }, [opacity, reducedMotion, toast, translateY]);

  const value = useMemo(() => ({ showToast }), [showToast]);

  const runAction = () => {
    if (!toast?.onAction) return;
    const action = toast.onAction;
    setToast(null);
    void action();
  };

  return (
    <ToastContext.Provider value={value}>
      <View style={styles.root}>
        {children}
        {toast ? (
          <Animated.View
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            pointerEvents={toast.onAction ? 'auto' : 'none'}
            style={[
              styles.toast,
              { bottom: insets.bottom + 84, opacity, transform: [{ translateY }] },
            ]}
          >
            <Text style={styles.message}>{toast.message}</Text>
            {toast.actionLabel && toast.onAction ? (
              <Pressable
                accessibilityRole="button"
                hitSlop={6}
                onPress={runAction}
                style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
              >
                <Text style={styles.actionLabel}>{toast.actionLabel}</Text>
              </Pressable>
            ) : null}
          </Animated.View>
        ) : null}
      </View>
    </ToastContext.Provider>
  );
}

/** 显示应用级短反馈。 */
export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast 必须在 ToastProvider 内使用');
  return value;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  toast: {
    position: 'absolute',
    left: 24,
    right: 24,
    zIndex: 40,
    maxWidth: 520,
    minHeight: 44,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: radius.md,
    backgroundColor: colors.black,
    elevation: 10,
  },
  message: {
    flex: 1,
    color: colors.background,
    fontFamily,
    ...typography.label,
    textAlign: 'center',
  },
  action: {
    minHeight: 44,
    minWidth: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  actionPressed: {
    opacity: 0.72,
  },
  actionLabel: {
    color: colors.primaryTrack,
    fontFamily,
    ...typography.label,
    fontWeight: '700',
  },
});
