import '@/global.css';

import { Stack } from 'expo-router';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { FocusPrototypeProvider } from '@/features/focus/focus-context';
import { colors } from '@/theme/tokens';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <FocusPrototypeProvider>
          <Stack
            screenOptions={{
              headerShown: false,
              // Expo Router 57 的原生栈在隐藏 Header 时仍会监听高度变化；
              // Android 首次切页可能在组件挂载前收到回调。显式空 Header
              // 会关闭这条无用监听，页面仍统一使用自己的 NavHeader。
              header: () => null,
              contentStyle: { backgroundColor: colors.background },
              animation: 'slide_from_right',
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="tasks/[id]" />
            <Stack.Screen name="tasks/new" />
            <Stack.Screen name="notes/[id]" />
            <Stack.Screen name="calendar" />
            <Stack.Screen name="me" />
            <Stack.Screen name="features/[slug]" />
            <Stack.Screen name="trips/index" />
            <Stack.Screen name="trips/[id]" />
            <Stack.Screen name="focus" />
            <Stack.Screen name="settings/index" />
            <Stack.Screen name="settings/detail" />
            <Stack.Screen
              name="capture/new"
              options={{
                animation: 'fade',
                presentation: 'transparentModal',
                contentStyle: { backgroundColor: 'transparent' },
              }}
            />
            <Stack.Screen name="capture/processing" />
            <Stack.Screen name="capture/confirm" />
            <Stack.Screen
              name="ai"
              options={{
                animation: 'fade',
                presentation: 'transparentModal',
                contentStyle: { backgroundColor: 'transparent' },
              }}
            />
          </Stack>
        </FocusPrototypeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
