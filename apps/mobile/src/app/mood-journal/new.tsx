import { createMoodJournalEntry, errorMessage } from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';

import { MoodEditor, type MoodEditorValue } from '@/features/mood-journal/mood-editor';
import { dateTimeForEntry, localDateKey, parseLocalDateKey } from '@/features/mood-journal/model';

export default function NewMoodJournalScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { date } = useLocalSearchParams<{ date?: string }>();
  const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? date! : localDateKey(new Date());
  const occurredAt = useMemo(() => {
    const value = parseLocalDateKey(dateKey);
    const now = new Date();
    value.setHours(now.getHours(), now.getMinutes(), 0, 0);
    return value;
  }, [dateKey]);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async (value: MoodEditorValue) => {
    setSaving(true);
    setFailure(null);
    try {
      const response = await createMoodJournalEntry({
        title: value.title.trim() || null,
        content: value.content,
        occurred_at: dateTimeForEntry(dateKey, occurredAt),
        mood_level: value.moodLevel,
        energy_level: value.energyLevel,
        emotion_words: value.emotionWords,
      });
      await queryClient.invalidateQueries();
      router.replace({ pathname: '/mood-journal/[id]', params: { id: response.data.id } });
      return true;
    } catch (error) {
      setFailure(errorMessage(error, '这篇日记没能保存，请稍后再试。'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  return (
    <MoodEditor
      draftKey={`steward.mood-journal.draft.${dateKey}`}
      failure={failure}
      occurredAt={occurredAt}
      onSubmit={submit}
      saving={saving}
    />
  );
}
