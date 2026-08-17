import type { PropsWithChildren } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppIcon } from '@/components/ui/icon';
import { colors, fontFamily, radius } from '@/theme/tokens';

type FocusSheetProps = PropsWithChildren<{
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
}>;

export function FocusSheet({
  visible,
  title,
  subtitle,
  onClose,
  children,
}: FocusSheetProps) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.layer}>
        <Pressable
          accessibilityLabel="关闭面板"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.backdrop}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          pointerEvents="box-none"
          style={styles.keyboardDock}
        >
          <View accessibilityViewIsModal style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <View style={styles.headerCopy}>
                <Text accessibilityRole="header" style={styles.title}>
                  {title}
                </Text>
                {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
              </View>
              <Pressable
                accessibilityLabel="关闭"
                accessibilityRole="button"
                hitSlop={8}
                onPress={onClose}
                style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
              >
                <AppIcon color={colors.textSecondary} name="close" size={23} />
              </Pressable>
            </View>
            {children}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  layer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(17, 24, 39, 0.28)',
  },
  keyboardDock: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '82%',
    paddingTop: 8,
    paddingHorizontal: 16,
    paddingBottom: 24,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.background,
  },
  handle: {
    width: 38,
    height: 4,
    alignSelf: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
  },
  header: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  headerCopy: {
    flex: 1,
  },
  title: {
    color: colors.text,
    fontFamily,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '700',
  },
  subtitle: {
    marginTop: 3,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 13,
    lineHeight: 19,
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  pressed: {
    opacity: 0.58,
  },
});
