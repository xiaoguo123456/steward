import { useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AiFab } from '@/components/ui/ai-fab';
import { AppScreen } from '@/components/ui/app-screen';
import { AppIcon } from '@/components/ui/icon';
import { colors, fontFamily, radius } from '@/theme/tokens';

type MenuItem = {
  title: string;
  icon: ComponentProps<typeof AppIcon>['name'];
  color: string;
  route?: '/focus' | '/settings';
};

const primaryMenu: MenuItem[] = [
  { title: '账户与安全', icon: 'shield-outline', color: colors.primary, route: '/settings' },
  { title: '通知提醒', icon: 'notifications-outline', color: colors.warning, route: '/settings' },
  { title: '外观主题', icon: 'moon-outline', color: colors.purple, route: '/settings' },
  { title: '专注设置', icon: 'timer-outline', color: colors.blue, route: '/focus' },
];

const secondaryMenu: MenuItem[] = [
  { title: '关于我们', icon: 'information-circle-outline', color: colors.textSecondary, route: '/settings' },
  { title: '意见反馈', icon: 'chatbox-outline', color: colors.primary, route: '/settings' },
];

function MenuCard({ items }: { items: MenuItem[] }) {
  const router = useRouter();
  return (
    <View style={styles.menuCard}>
      {items.map((item) => (
        <Pressable
          key={item.title}
          onPress={() => item.route && router.push(item.route)}
          style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}
        >
          <AppIcon color={item.color} name={item.icon} size={20} />
          <Text style={styles.menuTitle}>{item.title}</Text>
          <AppIcon color="#C9CFCC" name="chevron-forward" size={18} />
        </Pressable>
      ))}
    </View>
  );
}

export default function MeScreen() {
  return (
    <AppScreen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.pageTitle}>我的</Text>

        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <AppIcon color={colors.background} name="person" size={27} />
          </View>
          <View style={styles.profileCopy}>
            <Text style={styles.name}>张明</Text>
            <Text style={styles.email}>zhangming@example.com</Text>
          </View>
          <AppIcon color="#C9CFCC" name="chevron-forward" size={19} />
        </View>

        <View style={styles.statsCard}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>8</Text>
            <Text style={styles.statLabel}>今日任务</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>24</Text>
            <Text style={styles.statLabel}>已完成</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>2h</Text>
            <Text style={styles.statLabel}>专注时长</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>12</Text>
            <Text style={styles.statLabel}>连续打卡</Text>
          </View>
        </View>

        <MenuCard items={primaryMenu} />
        <MenuCard items={secondaryMenu} />
      </ScrollView>
      <AiFab count={3} />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingTop: 22,
    paddingBottom: 94,
  },
  pageTitle: {
    marginBottom: 16,
    color: colors.text,
    fontFamily,
    fontSize: 28,
    lineHeight: 38,
    fontWeight: '700',
  },
  profileCard: {
    minHeight: 96,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    backgroundColor: colors.background,
    shadowColor: '#0F2F24',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.05,
    shadowRadius: 11,
    elevation: 2,
  },
  avatar: {
    width: 56,
    height: 56,
    marginRight: 16,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  profileCopy: {
    flex: 1,
  },
  name: {
    color: colors.text,
    fontFamily,
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '600',
  },
  email: {
    marginTop: 3,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 13,
  },
  statsCard: {
    minHeight: 84,
    marginTop: 16,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    backgroundColor: colors.background,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    color: colors.text,
    fontFamily,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '700',
  },
  statLabel: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily,
    fontSize: 11,
    lineHeight: 16,
  },
  menuCard: {
    marginTop: 16,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.xl,
    backgroundColor: colors.background,
  },
  menuRow: {
    height: 46,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
  },
  pressed: {
    opacity: 0.55,
  },
  menuTitle: {
    flex: 1,
    color: colors.text,
    fontFamily,
    fontSize: 15,
    lineHeight: 22,
  },
});
