import { useListNotifications } from '@steward/api-client';
import { type Href, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppIcon } from '@/components/ui/icon';
import { colors, radius } from '@/theme/tokens';

/** 首页通知入口；请求与通知中心首屏使用同一个 Query Key。 */
export function NotificationEntry() {
  const router = useRouter();
  const notifications = useListNotifications({ limit: 20 });
  const hasUnread = notifications.data?.data.some((item) => item.read_at === null) ?? false;

  return (
    <Pressable
      accessibilityLabel={hasUnread ? '打开通知，有未读通知' : '打开通知'}
      accessibilityRole="button"
      onPress={() => router.push('/notifications' as Href)}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <AppIcon color={colors.text} name="notifications-outline" size={21} />
      {hasUnread ? <View accessibilityElementsHidden importantForAccessibility="no" style={styles.dot} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSubtle,
  },
  pressed: { opacity: 0.7 },
  dot: {
    position: 'absolute',
    top: 9,
    right: 9,
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
    borderWidth: 1.5,
    borderColor: colors.background,
  },
});
