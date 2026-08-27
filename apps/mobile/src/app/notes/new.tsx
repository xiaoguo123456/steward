import {
  createNote,
  errorMessage,
  isApiError,
  polishNoteDraft,
  useGetAiSettings,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { AppScreen } from '@/components/ui/app-screen';
import { NavHeader } from '@/components/ui/nav-header';
import { NoteEditor, type NoteDraft } from '@/features/notes/note-editor';

export default function NewNoteScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const aiSettings = useGetAiSettings();

  const submit = async (draft: NoteDraft) => {
    setSaving(true);
    setFailure(null);
    try {
      const created = await createNote({
        // 标题留空时交给服务端从正文首行生成，不在这里替它编一个。
        title: draft.title || null,
        content: draft.content,
        tags: draft.tags,
        polish_action_id: draft.polishActionId,
      });
      await queryClient.invalidateQueries();
      router.replace({ pathname: '/notes/[id]', params: { id: created.data.id } });
    } catch (error) {
      setFailure(errorMessage(error, '笔记没能保存。'));
    } finally {
      setSaving(false);
    }
  };

  const polish = async (draft: NoteDraft) => {
    try {
      const response = await polishNoteDraft({
        title: draft.title || null,
        content: draft.content,
      });
      return response.data;
    } catch (error) {
      if (isApiError(error) && error.code === 'INTERNAL_ERROR') {
        throw new Error('润色暂时不可用，请稍后再试。');
      }
      throw new Error(errorMessage(error, '这次没能润色，请稍后再试。'));
    }
  };

  return (
    <AppScreen includeBottomInset>
      <NavHeader title="新建笔记" />
      <NoteEditor
        failure={failure}
        onPolish={aiSettings.data?.data.suggestion_enabled === false ? undefined : polish}
        onSubmit={(draft) => void submit(draft)}
        saving={saving}
        submitLabel="保存"
      />
    </AppScreen>
  );
}
