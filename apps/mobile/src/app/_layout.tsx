import '@/global.css';

import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { colors } from '@/theme/tokens';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
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
        <Stack.Screen name="features/[slug]" />
        <Stack.Screen name="focus" />
        <Stack.Screen name="settings/index" />
        <Stack.Screen
          name="ai"
          options={{
            animation: 'fade',
            presentation: 'transparentModal',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}
