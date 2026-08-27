export type NotePolishDraft = {
  title: string;
  content: string;
  tags: string[];
  polishActionId?: string;
};

export type NotePolishCandidate = {
  title: string;
  content: string;
  ai_action_id: string;
};

/** 客户端再守一次“已有标题不改写”，避免异常响应覆盖用户明确输入。 */
export function applyNotePolish(
  draft: NotePolishDraft,
  candidate: NotePolishCandidate,
): NotePolishDraft {
  const currentTitle = draft.title.trim();
  return {
    ...draft,
    title: currentTitle || candidate.title.trim(),
    content: candidate.content.trim(),
    polishActionId: candidate.ai_action_id,
  };
}

export function canPolishNote(content: string, busy: boolean): boolean {
  return Boolean(content.trim()) && !busy;
}
