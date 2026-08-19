import { createNote, errorMessage } from '@steward/api-client';
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

  const submit = async (draft: NoteDraft) => {
    setSaving(true);
    setFailure(null);
    try {
      const created = await createNote({
        // 标题留空时交给服务端从正文首行生成，不在这里替它编一个。
        title: draft.title || null,
        content: draft.content,
        tags: draft.tags,
      });
      await queryClient.invalidateQueries();
      router.replace({ pathname: '/notes/[id]', params: { id: created.data.id } });
    } catch (error) {
      setFailure(errorMessage(error, '笔记没能保存。'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppScreen includeBottomInset>
      <NavHeader title="新建笔记" />
      <NoteEditor
        failure={failure}
        onCancel={() => router.back()}
        onSubmit={(draft) => void submit(draft)}
        saving={saving}
        submitLabel="保存"
      />
    </AppScreen>
  );
}
