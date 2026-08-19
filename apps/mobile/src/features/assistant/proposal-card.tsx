import {
  errorMessage,
  useConfirmProposal,
  useRejectProposal,
  type ActionProposal,
} from '@steward/api-client';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppIcon } from '@/components/ui/icon';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

/**
 * 建议确认卡片。
 *
 * 这里是「模型只产建议」这条规则在界面上的落点：用户不点确认，
 * 服务端就不会写任何正式数据。卡片必须让人看清三件事——
 * 会改什么、为什么这么建议、依据是什么。
 */
export function ProposalCard({
  proposal,
  onResolved,
}: {
  proposal: ActionProposal;
  onResolved: () => void;
}) {
  const [failure, setFailure] = useState<string | null>(null);

  const confirm = useConfirmProposal({
    mutation: {
      onSuccess: () => {
        setFailure(null);
        onResolved();
      },
      // 目标在这期间被改过、建议已过期或已处理，都会走到这里。
      // 服务端的文案已经说明了原因，直接展示，不要自己改写。
      onError: (error) => setFailure(errorMessage(error, '这条建议没能执行。')),
    },
  });
  const reject = useRejectProposal({
    mutation: {
      onSuccess: () => {
        setFailure(null);
        onResolved();
      },
      onError: (error) => setFailure(errorMessage(error, '操作没有成功。')),
    },
  });

  const busy = confirm.isPending || reject.isPending;
  const resolved = proposal.status !== 'pending';

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <AppIcon color={colors.primaryStrong} name="sparkles-outline" size={17} />
        <Text style={styles.title}>{proposal.preview.title}</Text>
      </View>

      {proposal.preview.changes?.length ? (
        <View style={styles.changes}>
          {proposal.preview.changes.map((change) => (
            <View key={change.field} style={styles.changeRow}>
              <Text style={styles.changeLabel}>{change.label}</Text>
              <View style={styles.changeValues}>
                {change.before ? (
                  <>
                    <Text style={styles.changeBefore}>{change.before}</Text>
                    <AppIcon color={colors.textTertiary} name="arrow-forward" size={13} />
                  </>
                ) : null}
                <Text style={styles.changeAfter}>{change.after ?? '—'}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {proposal.reason ? <Text style={styles.reason}>{proposal.reason}</Text> : null}
      {proposal.preview.impact ? (
        <Text style={styles.impact}>{proposal.preview.impact}</Text>
      ) : null}

      {failure ? <Text style={styles.failure}>{failure}</Text> : null}

      {resolved ? (
        <Text style={styles.resolved}>{resolvedLabel(proposal.status)}</Text>
      ) : (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() =>
              reject.mutate({ proposalId: proposal.id })
            }
            style={({ pressed }) => [styles.reject, pressed && styles.pressed]}
          >
            <Text style={styles.rejectText}>不用了</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() =>
              confirm.mutate({
                proposalId: proposal.id,
                // 版本对不上时服务端会拒绝，避免执行一条已经变过的建议。
                data: { proposal_version: proposal.version },
              })
            }
            style={({ pressed }) => [styles.confirm, pressed && styles.pressed]}
          >
            {busy ? (
              <ActivityIndicator color={colors.background} size="small" />
            ) : (
              <Text style={styles.confirmText}>确认执行</Text>
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
}

function resolvedLabel(status: ActionProposal['status']) {
  switch (status) {
    case 'executed':
      return '已执行';
    case 'rejected':
      return '已忽略';
    case 'expired':
      return '已过期，需要重新提问';
    case 'stale':
      return '内容已变动，需要重新提问';
    case 'superseded':
      return '已被新的建议取代';
    default:
      return '已处理';
  }
}

const styles = StyleSheet.create({
  card: {
    marginLeft: 39,
    padding: 14,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.primaryTrack,
    backgroundColor: colors.primarySoft,
    gap: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
  },
  title: {
    flex: 1,
    color: colors.text,
    fontFamily,
    ...typography.body,
    fontWeight: '600',
  },
  changes: {
    gap: 7,
  },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  changeLabel: {
    minWidth: 52,
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  changeValues: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  changeBefore: {
    color: colors.textTertiary,
    fontFamily,
    ...typography.meta,
    textDecorationLine: 'line-through',
  },
  changeAfter: {
    color: colors.text,
    fontFamily,
    ...typography.meta,
    fontWeight: '600',
  },
  reason: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
  },
  impact: {
    color: colors.textTertiary,
    fontFamily,
    ...typography.meta,
  },
  failure: {
    color: colors.danger,
    fontFamily,
    ...typography.meta,
  },
  resolved: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.meta,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: 9,
  },
  reject: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  rejectText: {
    color: colors.textSecondary,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  confirm: {
    flex: 1,
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  confirmText: {
    color: colors.background,
    fontFamily,
    ...typography.label,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.82,
  },
});
