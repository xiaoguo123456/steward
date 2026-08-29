import NetInfo from '@react-native-community/netinfo';
import { useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { AppState, Modal, StyleSheet, Text, View } from 'react-native';

import { session } from '@/api/session';
import { AppButton } from '@/components/ui/app-button';
import { ModalSheet } from '@/components/ui/modal-sheet';
import { useToast } from '@/components/ui/toast';
import { colors, fontFamily, typography } from '@/theme/tokens';

import { listCaptureDrafts, saveCaptureDraft } from './capture-draft-store';
import { canResumeUpload, type CaptureDraft } from './capture-draft-model';
import { processCaptureDraft } from './capture-upload-queue';

/**
 * 监听网络恢复与前台恢复。
 *
 * `waiting_for_network` 只提示，不自动上传原始媒体；用户点“现在上传”后才切到
 * `ready_for_upload`。已经确认过的队列在进程重启或回到前台时可以安全续传。
 */
export function CaptureQueueProvider({ children }: PropsWithChildren) {
  const toast = useToast();
  const [waiting, setWaiting] = useState<CaptureDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const onlineRef = useRef<boolean | null>(null);

  useEffect(() => {
    const inspect = async (offerWaiting: boolean) => {
      const accountId = session.userId();
      if (!accountId) return;
      const drafts = await listCaptureDrafts(accountId);
      if (offerWaiting) {
        setWaiting(drafts.filter((draft) => draft.status === 'waiting_for_network'));
      }
      const resumable = drafts.filter((draft) => canResumeUpload(draft.status));
      for (const draft of resumable) {
        void processCaptureDraft(accountId, draft.id).catch(() => undefined);
      }
    };

    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = state.isConnected === true && state.isInternetReachable !== false;
      const restored = online && onlineRef.current === false;
      onlineRef.current = online;
      if (online) void inspect(restored);
    });
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active' && onlineRef.current) void inspect(false);
    });
    return () => {
      unsubscribe();
      appState.remove();
    };
  }, []);

  const uploadNow = async () => {
    const accountId = session.userId();
    if (!accountId || busy) return;
    setBusy(true);
    const selected = waiting;
    setWaiting([]);
    try {
      for (const draft of selected) {
        const ready = { ...draft, status: 'ready_for_upload' as const, error: undefined };
        await saveCaptureDraft(accountId, ready);
        await processCaptureDraft(accountId, draft.id);
      }
      toast.showToast(selected.length > 1 ? `${selected.length} 条输入已提交` : '输入已提交');
    } catch {
      toast.showToast('部分输入尚未上传，可在“最近输入”里继续');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {children}
      {waiting.length ? (
        <Modal animationType="fade" onRequestClose={() => setWaiting([])} transparent visible>
          <ModalSheet onClose={() => setWaiting([])}>
            <View style={styles.content}>
              <Text accessibilityRole="header" style={styles.title}>
                网络已恢复
              </Text>
              <Text style={styles.copy}>
                {waiting.length} 条输入仍只保存在这台设备。现在上传后才会创建服务端 Capture，
                也可以稍后在“最近输入”中继续。
              </Text>
              <AppButton
                disabled={busy}
                label={busy ? '正在上传…' : '现在上传'}
                onPress={() => void uploadNow()}
              />
              <AppButton
                disabled={busy}
                label="稍后"
                onPress={() => setWaiting([])}
                variant="text"
              />
            </View>
          </ModalSheet>
        </Modal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  content: { gap: 14, paddingHorizontal: 20, paddingBottom: 24 },
  title: { color: colors.text, fontFamily, ...typography.section },
  copy: { color: colors.textSecondary, fontFamily, ...typography.body },
});
