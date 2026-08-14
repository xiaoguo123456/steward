import type { PropsWithChildren } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { colors } from '@/theme/tokens';

type AppScreenProps = PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  includeBottomInset?: boolean;
  backgroundColor?: string;
}>;

export function AppScreen({
  children,
  style,
  includeBottomInset = false,
  backgroundColor = colors.background,
}: AppScreenProps) {
  return (
    <SafeAreaView
      edges={includeBottomInset ? ['top', 'bottom'] : ['top']}
      style={[styles.screen, { backgroundColor }, style]}
    >
      <StatusBar style="dark" />
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
});
