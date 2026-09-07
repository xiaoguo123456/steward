import { isApiError, useGetProposal, type ActionProposal } from '@steward/api-client';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ProposalCard } from './proposal-card';

import { colors, fontFamily, radius, typography } from '@/theme/tokens';

// 待确认列表不是历史卡片的数据源；按消息的正式引用补读已处理建议。
export function MessageProposal({ id, pending, onResolved }: {
  id: string;
  pending?: ActionProposal;
  onResolved: () => void;
}) {
  const query = useGetProposal(id, { query: { enabled: !pending, retry: 1, staleTime: 30_000 } });
  const proposal = pending ?? query.data?.data;
  if (proposal) return <ProposalCard proposal={proposal} onResolved={() => { void query.refetch(); onResolved(); }} />;
  const unavailable = isApiError(query.error) && query.error.status === 404;
  return (
    <View style={styles.state}>
      {query.isError ? (
        <>
          <Text style={styles.copy}>{unavailable ? '这条建议已不可用' : '暂时无法读取这条建议'}</Text>
          {!unavailable ? <Pressable accessibilityRole="button" accessibilityState={{ disabled: query.isFetching }} disabled={query.isFetching} onPress={() => { void query.refetch(); }} style={styles.retry}>
            <Text style={styles.retryText}>{query.isFetching ? '正在加载…' : '重新加载'}</Text>
          </Pressable> : null}
        </>
      ) : <><ActivityIndicator color={colors.primaryStrong} /><Text style={styles.copy}>正在读取建议…</Text></>}
    </View>
  );
}

const styles = StyleSheet.create({
  state: { marginLeft: 39, borderRadius: radius.md, backgroundColor: colors.surfaceSubtle, padding: 14, gap: 8, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  copy: { color: colors.textSecondary, fontFamily, ...typography.meta },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
  retryText: { color: colors.primaryStrong, fontFamily, ...typography.label },
});
