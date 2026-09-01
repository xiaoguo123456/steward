import {
  errorMessage,
  useGetAiSettings,
  useUpdateAiSettings,
  type AiSettings,
} from '@steward/api-client';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { AppScreen } from '@/components/ui/app-screen';
import { FlatListGroup, FlatListRow } from '@/components/ui/flat-list';
import { NavHeader } from '@/components/ui/nav-header';
import { StatePanel } from '@/components/ui/state-panel';
import { colors, fontFamily, typography } from '@/theme/tokens';

/**
 * AI 设置。
 *
 * 这一页只放服务端真正生效的三个开关。产品上想要的「今日提醒」「项目总结」
 * 之类还没有对应能力，摆一个不起作用的开关比不摆更糟——用户会以为自己
 * 关掉了某件事。
 *
 * 每个开关都写清楚关掉之后会发生什么：这是隐私承诺的落点，
 * 含糊其辞等于没承诺。
 */

type ToggleKey = keyof Pick<
  AiSettings,
  'capture_parse_enabled' | 'suggestion_enabled' | 'memory_learning_enabled' | 'mood_journal_ai_enabled'
>;

const toggles: {
  key: ToggleKey;
  title: string;
  icon: 'sparkles-outline' | 'bulb-outline' | 'bookmark-outline' | 'document-text-outline';
  subtitle: string;
}[] = [
  {
    key: 'capture_parse_enabled',
    title: '智能整理输入',
    icon: 'sparkles-outline',
    subtitle: '关闭后，你记下的内容原样保留，由你自己填写要保存成什么。',
  },
  {
    key: 'suggestion_enabled',
    title: '生成待确认建议',
    icon: 'bulb-outline',
    subtitle: '关闭后，助理只回答问题，不再提出改动建议。它本来也不能直接改任何内容。',
  },
  {
    key: 'memory_learning_enabled',
    title: '学习长期偏好',
    icon: 'bookmark-outline',
    subtitle: '关闭后不再提出新的偏好。已经记住的仍然生效，可在「长期偏好」里逐条删除。',
  },
  {
    key: 'mood_journal_ai_enabled',
    title: '心情日记 AI',
    icon: 'document-text-outline',
    subtitle: '开启后，只有你点击排版润色时，当前日记正文才会发送给 AI；可随时关闭。',
  },
];

export default function AiSettingsScreen() {
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);

  const settings = useGetAiSettings();
  const update = useUpdateAiSettings({
    mutation: {
      onSuccess: () => {
        setFailure(null);
        void settings.refetch();
      },
      // 失败时不要留下一个「看起来已经关掉」的开关：
      // 重新拉一次，让界面回到服务端的真实状态。
      onError: (error) => {
        setFailure(errorMessage(error, '设置没能保存，请稍后再试。'));
        void settings.refetch();
      },
    },
  });

  const current = settings.data?.data;

  return (
    <AppScreen includeBottomInset>
      <NavHeader title="AI 设置" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.summary}>
          关闭某一项后不再生成新的对应内容，已经保存的结果仍然可以查看。
          任何情况下，AI 都不会不经你确认就改动你的内容。
        </Text>

        {failure ? <Text style={styles.failure}>{failure}</Text> : null}

        {settings.isError ? (
          <StatePanel
            actionLabel="重试"
            icon="cloud-offline-outline"
            message={errorMessage(settings.error, 'AI 设置暂时无法读取，请稍后重试。')}
            onAction={() => void settings.refetch()}
            title="加载失败"
          />
        ) : settings.isLoading || !current ? (
          <ActivityIndicator color={colors.primary} style={styles.loading} />
        ) : (
          <FlatListGroup>
            {toggles.map((item, index) => (
              <FlatListRow
                icon={item.icon}
                key={item.key}
                showChevron={false}
                showDivider={index < toggles.length - 1}
                subtitle={item.subtitle}
                title={item.title}
                trailing={
                  <Switch
                    accessibilityLabel={`${item.title}开关`}
                    disabled={update.isPending}
                    onValueChange={(value) => {
                      setFailure(null);
                      update.mutate({ data: { [item.key]: value } });
                    }}
                    thumbColor={colors.background}
                    trackColor={{ false: colors.borderStrong, true: colors.primary }}
                    value={current[item.key]}
                  />
                }
              />
            ))}
          </FlatListGroup>
        )}

        <View style={styles.group}>
          <Text accessibilityRole="header" style={styles.groupTitle}>长期偏好</Text>
          <FlatListGroup>
            <FlatListRow
              icon="list-outline"
              onPress={() => router.push('/settings/memories')}
              showDivider={false}
              subtitle="看到系统记住了什么、从哪里来，并可逐条删除"
              title="管理长期偏好"
            />
          </FlatListGroup>
        </View>
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 28,
  },
  summary: {
    marginBottom: 14,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  failure: {
    marginBottom: 12,
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  loading: {
    marginTop: 24,
  },
  group: {
    marginTop: 22,
  },
  groupTitle: {
    marginBottom: 10,
    color: colors.text,
    fontFamily,
    ...typography.section,
  },
});
