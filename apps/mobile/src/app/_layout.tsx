import '@/global.css';

import { Stack } from 'expo-router';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiProvider } from '@/api/provider';
import { ToastProvider } from '@/components/ui/toast';
import { FocusPrototypeProvider } from '@/features/focus/focus-context';
import { colors } from '@/theme/tokens';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ApiProvider>
          <ToastProvider>
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
                <Stack.Screen name="relationships-preview" />
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="tasks/[id]" />
                <Stack.Screen name="tasks/new" />
                <Stack.Screen name="notes/[id]" />
                <Stack.Screen name="notes/new" />
                <Stack.Screen name="lists/manage" />
                <Stack.Screen name="trackers/new" />
                <Stack.Screen name="trackers/manage" />
                <Stack.Screen name="trackers/[id]" />
                <Stack.Screen name="projects/[id]" />
                <Stack.Screen name="calendar" />
                <Stack.Screen name="me" />
                <Stack.Screen name="features/[slug]" />
                <Stack.Screen name="trips/index" />
                <Stack.Screen name="trips/new" />
                <Stack.Screen name="trips/new-item" />
                <Stack.Screen name="trips/[id]" />
                <Stack.Screen name="focus" />
                <Stack.Screen name="settings/ai" />
                <Stack.Screen name="settings/preferences" />
                <Stack.Screen name="settings/phone" />
                <Stack.Screen name="settings/memories" />
                <Stack.Screen name="assistant/threads" />
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
          </ToastProvider>
        </ApiProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
