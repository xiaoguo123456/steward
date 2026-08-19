import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { AiFab } from '@/components/ui/ai-fab';
import { AppScreen } from '@/components/ui/app-screen';
import { FlatListGroup, FlatListRow } from '@/components/ui/flat-list';
import { NavHeader } from '@/components/ui/nav-header';
import { colors, fontFamily, typography } from '@/theme/tokens';

export default function SettingsScreen() {
  const router = useRouter();

  return (
    <AppScreen includeBottomInset>
      <NavHeader title="设置" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>日常使用</Text>
        <FlatListGroup>
          <FlatListRow icon="time-outline" onPress={() => router.push({ pathname: '/settings/detail', params: { section: 'habits' } })} subtitle="工作日 09:00—18:00" title="使用习惯" />
          <FlatListRow icon="sparkles-outline" onPress={() => router.push('/settings/ai')} subtitle="智能整理、建议与长期偏好" title="AI 设置" />
          <FlatListRow icon="notifications-outline" onPress={() => router.push({ pathname: '/settings/detail', params: { section: 'notifications' } })} showDivider={false} subtitle="事件前 10 分钟" title="通知设置" />
        </FlatListGroup>

        <Text accessibilityRole="header" style={styles.sectionTitle}>数据与账户</Text>
        <FlatListGroup>
          <FlatListRow icon="folder-open-outline" onPress={() => router.push({ pathname: '/settings/detail', params: { section: 'data' } })} title="原始输入" />
          <FlatListRow icon="trash-outline" onPress={() => router.push({ pathname: '/settings/detail', params: { section: 'data' } })} subtitle="内容保留 30 天" title="最近删除" />
          <FlatListRow icon="download-outline" onPress={() => router.push({ pathname: '/settings/detail', params: { section: 'data' } })} title="导出个人数据" />
          <FlatListRow icon="shield-checkmark-outline" onPress={() => router.push({ pathname: '/settings/detail', params: { section: 'data' } })} title="隐私与数据" />
          <FlatListRow icon="person-outline" onPress={() => router.push({ pathname: '/settings/detail', params: { section: 'account' } })} showDivider={false} title="账号与安全" />
        </FlatListGroup>

        <Text style={styles.version}>清单 0.1.0 · Development Build</Text>
      </ScrollView>
      <AiFab count={1} />
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
