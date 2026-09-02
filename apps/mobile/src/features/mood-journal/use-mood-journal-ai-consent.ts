import { getAiSettings, getGetAiSettingsQueryKey, updateAiSettings } from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';

import { confirmAction } from '@/components/ui/confirm-action';

export function useMoodJournalAiConsent() {
  const queryClient = useQueryClient();
  return async (scope: 'current' | 'selected') => {
    const settings = (await getAiSettings()).data;
    if (!settings.suggestion_enabled) throw new Error('AI 建议已关闭，可在设置中重新开启。');
    if (settings.mood_journal_ai_enabled) return true;
    const accepted = await requestConsent(scope);
    if (!accepted) return false;
    await updateAiSettings({ mood_journal_ai_enabled: true });
    await queryClient.invalidateQueries({ queryKey: getGetAiSettingsQueryKey() });
    return true;
  };
}

function requestConsent(scope: 'current' | 'selected'): Promise<boolean> {
  const sent = scope === 'current' ? '当前这一篇日记的纯文本正文' : '本次明确选择且未排除 AI 的日记日期与纯文本正文';
  const message = `只会发送${sent}，不发送心情结构、位置、媒体、其他笔记或长期记忆。结果只作为可跳过的候选，不会自动改写日记或写入记忆；之后可随时在 AI 设置中关闭。`;
  return confirmAction({
    title: '允许 AI 阅读本次正文？',
    message,
    cancelLabel: '暂不使用',
    confirmLabel: '同意并继续',
  });
}
