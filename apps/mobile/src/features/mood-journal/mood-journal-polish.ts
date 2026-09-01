import type { NoteContentBlocksV1 } from '@steward/api-client';

export type MoodJournalPolishCandidate = {
  content: NoteContentBlocksV1;
  ai_action_id: string;
};

export function canPolishMoodJournal(content: NoteContentBlocksV1, busy: boolean): boolean {
  return !busy && content.blocks.some((block) =>
    block.runs.some((run) => run.text.trim().length > 0));
}

export function applyMoodJournalPolish(
  content: NoteContentBlocksV1,
  candidate: MoodJournalPolishCandidate,
): { content: NoteContentBlocksV1; polishActionId: string } {
  return {
    content: candidate.content,
    polishActionId: candidate.ai_action_id,
  };
}
