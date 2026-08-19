import { errorMessage } from '@steward/api-client';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AiFab } from '@/components/ui/ai-fab';
import { AppScreen } from '@/components/ui/app-screen';
import { FlatListGroup, FlatListRow } from '@/components/ui/flat-list';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { StatePanel } from '@/components/ui/state-panel';
import {
  avatarInitial,
  preferencesSummary,
  useCurrentUser,
  useUserPreferences,
} from '@/features/account/use-account';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

/**
 * 账户与设置。
 *
 * 这里只放已经接通的入口。做不了的事不摆在这儿：
 * 一个点了没反应的「通知设置」比没有这一行更让人困惑，
 * 用户会以为自己关掉了提醒。
 */
export default function MeScreen() {
  const router = useRouter();
  const { user, loading, failed, error, refetch } = useCurrentUser();
  const { preferences } = useUserPreferences();

  return (
    <AppScreen includeBottomInset>
      <NavHeader title="账户与设置" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {failed ? (
          <StatePanel
            actionLabel="重试"
            icon="cloud-offline-outline"
            message={errorMessage(error, '暂时无法加载账户信息。')}
            onAction={refetch}
            title="加载失败"
          />
        ) : loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <Pressable
            accessibilityLabel="编辑个人资料"
            accessibilityRole="button"
            onPress={() => router.push('/settings/profile')}
            style={({ pressed }) => [styles.profile, pressed && styles.pressed]}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{avatarInitial(user?.display_name)}</Text>
            </View>
            <View style={styles.profileCopy}>
              <Text style={styles.name}>{user?.display_name}</Text>
              {/* 手机号由服务端脱敏后下发，客户端不做还原也不做拼接。 */}
              <Text style={styles.phone}>{user?.phone}</Text>
            </View>
            <AppIcon color={colors.borderStrong} name="chevron-forward" size={18} />
          </Pressable>
        )}

        <Text accessibilityRole="header" style={styles.groupTitle}>
          偏好
        </Text>
        <FlatListGroup>
          <FlatListRow
            icon="time-outline"
            onPress={() => router.push('/settings/preferences')}
            subtitle={preferencesSummary(preferences)}
            title="时间与作息"
          />
          <FlatListRow
            icon="sparkles-outline"
            onPress={() => router.push('/settings/ai')}
            subtitle="智能整理、建议与长期偏好"
            title="AI 设置"
          />
          <FlatListRow
            icon="bookmark-outline"
            onPress={() => router.push('/settings/memories')}
            subtitle="助理记住的长期偏好"
            title="长期记忆"
          />
          <FlatListRow
            icon="timer-outline"
            onPress={() => router.push('/focus')}
            showDivider={false}
            title="专注设置"
          />
        </FlatListGroup>

        <Text accessibilityRole="header" style={styles.groupTitle}>
          账户
        </Text>
        <FlatListGroup>
          <FlatListRow
            icon="person-circle-outline"
            onPress={() => router.push('/settings/account')}
            showDivider={false}
            subtitle={user?.phone}
            title="账号与登录"
          />
        </FlatListGroup>

        <Pressable
          accessibilityLabel="打开全部设置"
          accessibilityRole="button"
          onPress={() => router.push('/settings')}
          style={({ pressed }) => [styles.moreRow, pressed && styles.pressed]}
        >
          <Text style={styles.moreText}>全部设置</Text>
          <AppIcon color={colors.borderStrong} name="chevron-forward" size={17} />
        </Pressable>
      </ScrollView>
      <AiFab />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 92,
  },
  loading: {
    paddingVertical: 40,
    alignItems: 'center',
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
  phone: {
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
  moreRow: {
    marginTop: 24,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  moreText: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.body,
  },
});
