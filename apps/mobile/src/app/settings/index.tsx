import { useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { colors, fontFamily, radius } from '@/theme/tokens';

type SettingItem = {
  title: string;
  icon: ComponentProps<typeof AppIcon>['name'];
  color: string;
  action?: () => void;
};

export default function SettingsScreen() {
  const router = useRouter();
  const items: SettingItem[] = [
    { title: '账户与安全', icon: 'shield-outline', color: colors.primary },
    { title: '通知提醒', icon: 'notifications-outline', color: colors.warning },
    { title: '外观主题', icon: 'moon-outline', color: colors.purple },
    {
      title: '专注设置',
      icon: 'timer-outline',
      color: colors.blue,
      action: () => router.push('/focus'),
    },
    { title: '关于我们', icon: 'information-circle-outline', color: colors.textSecondary },
    { title: '意见反馈', icon: 'chatbox-outline', color: colors.primary },
  ];

  return (
    <AppScreen includeBottomInset>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>设置</Text>
        </View>
        <View style={styles.card}>
          {items.map((item) => (
            <Pressable
              key={item.title}
              onPress={item.action}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <AppIcon color={item.color} name={item.icon} size={20} />
              <Text style={styles.rowTitle}>{item.title}</Text>
              <AppIcon color="#C9CFCC" name="chevron-forward" size={18} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  titleRow: {
    height: 64,
    paddingHorizontal: 36,
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    color: colors.text,
    fontFamily,
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '600',
  },
  card: {
    marginTop: 4,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  },
  row: {
    height: 50,
    paddingHorizontal: 17,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  pressed: {
    opacity: 0.55,
  },
  rowTitle: {
    flex: 1,
    color: colors.text,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
  },
});
