import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AiFab } from '@/components/ui/ai-fab';
import { AppScreen } from '@/components/ui/app-screen';
import { FlatListGroup, FlatListRow } from '@/components/ui/flat-list';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

export default function MeScreen() {
  const router = useRouter();

  return (
    <AppScreen includeBottomInset>
      <NavHeader title="账户与设置" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/settings')}
          style={({ pressed }) => [styles.profile, pressed && styles.pressed]}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>张</Text>
          </View>
          <View style={styles.profileCopy}>
            <Text style={styles.name}>张明</Text>
            <Text style={styles.email}>zhangming@example.com</Text>
          </View>
          <AppIcon color={colors.borderStrong} name="chevron-forward" size={18} />
        </Pressable>

        <Text accessibilityRole="header" style={styles.groupTitle}>偏好与提醒</Text>
        <FlatListGroup>
          <FlatListRow icon="options-outline" onPress={() => router.push({ pathname: '/settings/detail', params: { section: 'habits' } })} title="使用习惯" />
          <FlatListRow icon="sparkles-outline" onPress={() => router.push({ pathname: '/settings/detail', params: { section: 'ai' } })} title="AI 设置与偏好" />
          <FlatListRow icon="notifications-outline" onPress={() => router.push({ pathname: '/settings/detail', params: { section: 'notifications' } })} title="通知设置" />
          <FlatListRow icon="timer-outline" onPress={() => router.push('/focus')} showDivider={false} title="专注设置" />
        </FlatListGroup>

        <Text accessibilityRole="header" style={styles.groupTitle}>数据与账户</Text>
        <FlatListGroup>
          <FlatListRow icon="lock-closed-outline" onPress={() => router.push({ pathname: '/settings/detail', params: { section: 'data' } })} title="数据与隐私" />
          <FlatListRow icon="person-circle-outline" onPress={() => router.push({ pathname: '/settings/detail', params: { section: 'account' } })} title="账号与安全" />
          <FlatListRow icon="chatbox-outline" onPress={() => router.push('/settings')} title="意见反馈" />
          <FlatListRow icon="information-circle-outline" onPress={() => router.push('/settings')} showDivider={false} title="关于产品" />
        </FlatListGroup>
      </ScrollView>
      <AiFab count={3} />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 92,
  },
  profile: {
    minHeight: 82,
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSubtle,
  },
  pressed: {
    opacity: 0.68,
  },
  avatar: {
    width: 48,
    height: 48,
    marginRight: 12,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  avatarText: {
    color: colors.background,
    fontFamily,
    ...typography.section,
    fontSize: 18,
  },
  profileCopy: {
    flex: 1,
  },
  name: {
    color: colors.text,
    fontFamily,
    ...typography.bodyStrong,
  },
  email: {
    marginTop: 2,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  groupTitle: {
    marginTop: 24,
    marginBottom: 10,
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
});
