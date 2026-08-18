import type { PropsWithChildren } from 'react';
import type { DimensionValue } from 'react-native';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius } from '@/theme/tokens';

type ModalSheetProps = PropsWithChildren<{
  onClose: () => void;
  maxHeight?: DimensionValue;
  dimmed?: boolean;
}>;

export function ModalSheet({
  children,
  onClose,
  maxHeight = '88%',
  dimmed = true,
}: ModalSheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView
      edges={['top', 'right', 'left']}
      style={[styles.overlay, dimmed && styles.dimmed]}
    >
      <Pressable accessibilityLabel="关闭面板" onPress={onClose} style={styles.backdrop} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        pointerEvents="box-none"
        style={styles.keyboardArea}
      >
        <View style={[styles.sheet, { maxHeight, paddingBottom: insets.bottom }]}>
          <View style={styles.grabber} />
          {children}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
  },
  dimmed: {
    backgroundColor: 'rgba(16, 30, 25, 0.22)',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  keyboardArea: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    width: '100%',
    maxWidth: 520,
    minHeight: 240,
    alignSelf: 'center',
    overflow: 'hidden',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.background,
  },
  grabber: {
    width: 38,
    height: 4,
    marginTop: 9,
    marginBottom: 3,
    alignSelf: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
  },
});
