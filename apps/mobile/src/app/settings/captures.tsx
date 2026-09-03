import NetInfo from '@react-native-community/netinfo';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { session } from '@/api/session';
import { AppButton } from '@/components/ui/app-button';
import { AppScreen } from '@/components/ui/app-screen';
import { confirmAction } from '@/components/ui/confirm-action';
import { AppIcon } from '@/components/ui/icon';
import { NavHeader } from '@/components/ui/nav-header';
import { StatePanel } from '@/components/ui/state-panel';
import {
  deleteCaptureDraft,
  listCaptureDrafts,
  saveCaptureDraft,
} from '@/features/capture/capture-draft-store';
import {
  draftSummary,
  type CaptureDraft,
  type CaptureDraftStatus,
} from '@/features/capture/capture-draft-model';
import { processCaptureDraft } from '@/features/capture/capture-upload-queue';
import { colors, fontFamily, radius, typography } from '@/theme/tokens';

const statusCopy: Record<CaptureDraftStatus, string> = {
  editing: '设备草稿',
  waiting_for_network: '等待网络，尚未上传',
  ready_for_upload: '等待上传',
  uploading: '正在上传',
  failed_retryable: '上传未完成',
  needs_user: '需要重新选择文件',
  submitted: '已提交',
};

export default function CaptureDraftsScreen() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<CaptureDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const accountId = session.userId();
    if (!accountId) return;
    setLoading(true);
    try {
      setDrafts(await listCaptureDrafts(accountId));
      setError(null);
    } catch {
      setError('最近输入暂时无法读取。');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void reload(); }, [reload]));

  const upload = async (draft: CaptureDraft) => {
    const accountId = session.userId();
    if (!accountId || busyId) return;
    const network = await NetInfo.fetch();
    if (network.isConnected !== true || network.isInternetReachable === false) {
      setError('当前仍未联网，这条输入还只保存在设备上。');
      return;
    }
    setBusyId(draft.id);
    setError(null);
    try {
      const ready = { ...draft, status: 'ready_for_upload' as const, error: undefined };
      await saveCaptureDraft(accountId, ready);
      const submitted = await processCaptureDraft(accountId, draft.id);
      router.push({
        pathname: '/ai',
        params: {
          captureId: submitted.captureId ?? '',
          operationId: submitted.operationId ?? '',
          draft: draftSummary(submitted),
          intent: submitted.intent,
          projectId: submitted.projectId,
        },
      });
    } catch {
      await reload();
      setError('上传还没完成，稍后可以继续重试。');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (draft: CaptureDraft) => {
    const accountId = session.userId();
    if (!accountId || busyId) return;
    const confirmed = await confirmAction({
      title: '删除这条最近输入？',
      message: '设备草稿、离线上传状态和关联的本地媒体都会一起删除，删除后无法恢复。',
      cancelLabel: '保留',
      confirmLabel: '删除',
      destructive: true,
    });
    if (!confirmed) return;
    setBusyId(draft.id);
    await deleteCaptureDraft(accountId, draft.id).catch(() => {
      setError('这条输入没能删除，请重试。');
    });
    await reload();
    setBusyId(null);
  };

  return (
    <AppScreen>
      <NavHeader title="最近输入" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.notice}>
          <AppIcon color={colors.primaryStrong} name="shield-checkmark-outline" size={20} />
          <Text style={styles.noticeText}>
            设备草稿按账号隔离保存。标为“等待网络”的内容尚未上传；网络恢复后仍会先询问你。
          </Text>
        </View>

        {loading ? (
          <StatePanel icon="time-outline" message="正在读取设备草稿与上传队列。" title="加载中" />
        ) : error && drafts.length === 0 ? (
          <StatePanel actionLabel="重试" icon="cloud-offline-outline" message={error} onAction={reload} title="读取失败" />
        ) : drafts.length === 0 ? (
          <StatePanel icon="document-text-outline" message="保存草稿或离线发送后，会出现在这里。" title="还没有最近输入" />
        ) : (
          <View style={styles.list}>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {drafts.map((draft) => {
              const editable = draft.status === 'editing' || draft.status === 'needs_user';
              const uploadable = draft.status === 'waiting_for_network'
                || draft.status === 'failed_retryable'
                || draft.status === 'ready_for_upload';
              return (
                <View key={draft.id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <View style={styles.cardCopy}>
                      <Text numberOfLines={2} style={styles.title}>{draftSummary(draft)}</Text>
                      <Text style={styles.meta}>
                        {statusCopy[draft.status]} · {formatTime(draft.updatedAt)}
                      </Text>
                    </View>
                    <View style={[styles.statusDot, draft.status === 'submitted' && styles.statusDotDone]} />
                  </View>
                  {draft.error ? <Text style={styles.itemError}>{draft.error}</Text> : null}
                  <View style={styles.actions}>
                    {editable ? (
                      <AppButton
                        disabled={busyId === draft.id}
                        label="继续编辑"
                        onPress={() => router.push({ pathname: '/capture/new', params: { draftId: draft.id } })}
						compact
                      />
                    ) : null}
                    {uploadable ? (
                      <AppButton
                        disabled={busyId === draft.id}
                        label={busyId === draft.id ? '正在上传…' : '现在上传'}
                        onPress={() => void upload(draft)}
						compact
                      />
                    ) : null}
                    {draft.status === 'submitted' && draft.captureId && draft.operationId ? (
                      <AppButton
                        label="打开 AI 管家"
                        onPress={() => router.push({
                          pathname: '/ai',
                          params: {
                            captureId: draft.captureId,
                            operationId: draft.operationId,
                            draft: draftSummary(draft),
                          },
                        })}
						compact
                        variant="secondary"
                      />
                    ) : null}
                    <Pressable
                      accessibilityLabel="删除这条最近输入"
                      accessibilityRole="button"
                      disabled={busyId === draft.id}
                      onPress={() => void remove(draft)}
                      style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}
                    >
                      <AppIcon color={colors.danger} name="trash-outline" size={19} />
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </AppScreen>
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40, gap: 16 },
  notice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    padding: 14, borderRadius: radius.lg, backgroundColor: colors.primarySoft,
  },
  noticeText: { flex: 1, color: colors.textSecondary, fontFamily, ...typography.meta },
  list: { gap: 12 },
  card: {
    padding: 16, borderRadius: radius.lg, borderWidth: 1,
    borderColor: colors.border, backgroundColor: colors.background, gap: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  cardCopy: { flex: 1, gap: 5 },
  title: { color: colors.text, fontFamily, ...typography.bodyStrong },
  meta: { color: colors.textTertiary, fontFamily, ...typography.caption },
  statusDot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.warning },
  statusDotDone: { backgroundColor: colors.primary },
  itemError: { color: colors.danger, fontFamily, ...typography.meta },
  error: { color: colors.danger, fontFamily, ...typography.meta },
  actions: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  deleteButton: {
    width: 44, height: 44, marginLeft: 'auto', borderRadius: radius.pill,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dangerSoft,
  },
  pressed: { opacity: 0.72 },
});
