import '@/global.css';

import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { FocusPrototypeProvider } from '@/features/focus/focus-context';
import { colors } from '@/theme/tokens';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <FocusPrototypeProvider>
        <Stack
          screenOptions={{
            headerShown: false,
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
  );
}
