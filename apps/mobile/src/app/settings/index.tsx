import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { AiFab } from '@/components/ui/ai-fab';
import { AppScreen } from '@/components/ui/app-screen';
import { FlatListGroup, FlatListRow } from '@/components/ui/flat-list';
import { NavHeader } from '@/components/ui/nav-header';
import { preferencesSummary, useUserPreferences } from '@/features/account/use-account';
import { colors, fontFamily, typography } from '@/theme/tokens';

/**
 * 设置。
 *
 * 只列已经接通的入口。原来这里还有「原始输入」「最近删除」「导出个人数据」
 * 「隐私与数据」，点进去都是同一页写死的假清单——契约里还没有这些操作。
 * 等它们真的做出来再放回来。
 */
export default function SettingsScreen() {
  const router = useRouter();
  const { preferences } = useUserPreferences();

  return (
    <AppScreen includeBottomInset>
      <NavHeader onBack={() => router.back()} title="设置" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          日常使用
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
            showDivider={false}
            subtitle="助理记住的长期偏好"
            title="长期记忆"
          />
        </FlatListGroup>

        <Text accessibilityRole="header" style={styles.sectionTitle}>
          账户
        </Text>
        <FlatListGroup>
          <FlatListRow
            icon="person-outline"
            onPress={() => router.push('/settings/profile')}
            title="个人资料"
          />
          <FlatListRow
            icon="person-circle-outline"
            onPress={() => router.push('/settings/account')}
            showDivider={false}
            title="账号与登录"
          />
        </FlatListGroup>

        <Text style={styles.version}>清单 0.1.0 · Development Build</Text>
      </ScrollView>
      <AiFab />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 92,
  },
  sectionTitle: {
    marginTop: 18,
    marginBottom: 10,
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
  version: {
    marginTop: 28,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    textAlign: 'center',
  },
});
