import {
  errorMessage,
  getAiSettings,
  getGetAiSettingsQueryKey,
  polishMoodJournalDraft,
  updateAiSettings,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';

import type { MoodEditorValue } from './mood-editor';
import type { MoodJournalPolishCandidate } from './mood-journal-polish';

export function useMoodJournalPolish() {
  const queryClient = useQueryClient();

  return async (draft: MoodEditorValue): Promise<MoodJournalPolishCandidate | null> => {
    let settings;
    try {
      settings = (await getAiSettings()).data;
    } catch (error) {
      throw new Error(errorMessage(error, '暂时无法读取 AI 设置，请稍后再试。'));
    }
    if (!settings.suggestion_enabled) {
      throw new Error('AI 建议已关闭，可在设置中重新开启。');
    }
    if (!settings.mood_journal_ai_enabled) {
      const allowed = await requestMoodJournalAiConsent();
      if (!allowed) return null;
      try {
        await updateAiSettings({ mood_journal_ai_enabled: true });
        await queryClient.invalidateQueries({ queryKey: getGetAiSettingsQueryKey() });
      } catch (error) {
        throw new Error(errorMessage(error, '心情日记 AI 授权没有保存，请稍后再试。'));
      }
    }

    try {
      const response = await polishMoodJournalDraft({ content: draft.content });
      return response.data;
    } catch (error) {
      throw new Error(errorMessage(error, '这次没能完成排版润色，请稍后再试。'));
    }
  };
}

function requestMoodJournalAiConsent(): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      '允许 AI 排版润色？',
      '只会发送当前这篇日记的正文和排版结构，不发送心情、精力、其他日记或长期偏好。结果只回到草稿，仍需你点击“完成”才会保存；之后可随时在 AI 设置中关闭。',
      [
        { text: '暂不使用', style: 'cancel', onPress: () => resolve(false) },
        { text: '同意并继续', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
