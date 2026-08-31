import '@/global.css';

import { Stack } from 'expo-router';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiProvider, useBootState } from '@/api/provider';
import { ToastProvider } from '@/components/ui/toast';
import { FocusPrototypeProvider } from '@/features/focus/focus-context';
import { CaptureQueueProvider } from '@/features/capture/capture-queue-provider';
import { colors } from '@/theme/tokens';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ApiProvider>
          <ToastProvider>
            <CaptureQueueProvider>
              <FocusPrototypeProvider>
                <RootNavigator />
              </FocusPrototypeProvider>
            </CaptureQueueProvider>
          </ToastProvider>
        </ApiProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * 登录态恢复完成前只开放根入口；恢复后由 Expo Router 的保护路由统一拦截深链。
 * 这样未登录用户即使直接打开详情 URL，也不会先挂载受保护页面和发出私有查询。
 */
function RootNavigator() {
  const boot = useBootState();

  return (
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
	  <Stack.Screen name="account-deletion" />

      <Stack.Protected guard={boot === 'signed-out'}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>

      <Stack.Protected guard={boot === 'signed-in'}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="tasks/[id]" />
        <Stack.Screen name="tasks/new" />
        <Stack.Screen name="notes/[id]" />
        <Stack.Screen name="notes/new" />
        <Stack.Screen name="mood-journal/new" />
        <Stack.Screen name="mood-journal/[id]" />
        <Stack.Screen name="mood-journal/calendar" />
        <Stack.Screen name="mood-journal/search" />
        <Stack.Screen name="mood-journal/garden" />
        <Stack.Screen name="lists/manage" />
        <Stack.Screen name="trackers/new" />
        <Stack.Screen name="trackers/manage" />
        <Stack.Screen name="trackers/[id]" />
        <Stack.Screen name="projects/[id]" />
        <Stack.Screen name="calendar" />
        <Stack.Screen name="memories/calendar" />
        <Stack.Screen name="memories/new" />
        <Stack.Screen name="memories/[id]" />
        <Stack.Screen name="people/new" />
        <Stack.Screen name="people/[id]" />
        <Stack.Screen name="people/[id]/edit" />
        <Stack.Screen name="people/[id]/interaction/new" />
        <Stack.Screen name="people/[id]/event/new" />
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
		<Stack.Screen name="settings/captures" />
        <Stack.Screen name="assistant/threads" />
        <Stack.Screen
          name="assistant/pending"
          options={{
            animation: 'fade',
            presentation: 'transparentModal',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
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
      </Stack.Protected>
    </Stack>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
