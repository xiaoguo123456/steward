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

        <View style={styles.sectionHeading}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>本周回顾</Text>
          <Text style={styles.sectionMeta}>8月12日—8月18日</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.reviewRow, pressed && styles.pressed]}
        >
          <View style={styles.reviewMetric}>
            <Text style={styles.reviewValue}>24</Text>
            <Text style={styles.reviewLabel}>完成事项</Text>
          </View>
          <View style={styles.reviewDivider} />
          <View style={styles.reviewCopy}>
            <Text style={styles.reviewTitle}>工作日上午完成度更稳定</Text>
            <Text style={styles.reviewMeta}>还有 3 项任务待安排</Text>
          </View>
          <Text style={styles.reviewAction}>查看</Text>
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
  sectionHeading: {
    minHeight: 48,
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  sectionMeta: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  reviewRow: {
    minHeight: 88,
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSubtle,
  },
  reviewMetric: {
    width: 54,
  },
  reviewValue: {
    color: colors.text,
    fontFamily,
    ...typography.metric,
    fontVariant: ['tabular-nums'],
  },
  reviewLabel: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.caption,
    fontSize: 11,
    lineHeight: 16,
  },
  reviewDivider: {
    width: StyleSheet.hairlineWidth,
    height: 46,
    marginHorizontal: 14,
    backgroundColor: colors.border,
  },
  reviewCopy: {
    flex: 1,
    paddingRight: 8,
  },
  reviewTitle: {
    color: colors.text,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  reviewMeta: {
    marginTop: 3,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  reviewAction: {
    color: colors.primaryStrong,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  groupTitle: {
    marginTop: 24,
    marginBottom: 10,
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
});
