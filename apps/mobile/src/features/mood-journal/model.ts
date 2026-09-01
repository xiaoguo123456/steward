import type {
  MoodJournalEntry,
  MoodLevel,
  NoteBlock,
  NoteContentBlocksV1,
} from '@steward/api-client';

export const moodLabels: Record<MoodLevel, string> = {
  very_low: '低落',
  low: '有点低落',
  neutral: '平静',
  good: '愉悦',
  very_good: '很好',
};

export const moodOptions: { value: MoodLevel; label: string }[] = [
  { value: 'very_low', label: '低落' },
  { value: 'low', label: '有点低落' },
  { value: 'neutral', label: '平静' },
  { value: 'good', label: '愉悦' },
  { value: 'very_good', label: '很好' },
];

export function createParagraphBlock(text = '', index = 0): NoteBlock {
  return {
    id: `blk_${Date.now().toString(36)}_${index}`,
    type: 'paragraph',
    runs: [{ text }],
  };
}

export function createBlocksDocument(text = ''): NoteContentBlocksV1 {
  return { format: 'blocks_v1', version: 1, blocks: [createParagraphBlock(text)] };
}

export function blocksPlaintext(content: NoteContentBlocksV1): string {
  return content.blocks
    .map((block) => block.runs.map((run) => run.text).join(''))
    .join('\n')
    .trim();
}

// 旧版手动工具栏可能在未保存草稿里留下多个空块。新版一键排版不再让用户
// 手动管理空块，恢复时只保留有正文的块；全空则回到单个普通段落。
export function compactMoodJournalDraft(content: NoteContentBlocksV1): NoteContentBlocksV1 {
  const blocks = content.blocks.filter((block) =>
    block.runs.some((run) => run.text.trim().length > 0));
  return blocks.length > 0 ? { ...content, blocks } : createBlocksDocument();
}

export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseLocalDateKey(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

export function recentSevenDays(today = new Date()) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - 6 + index);
    return {
      key: localDateKey(date),
      day: date.getDate(),
      weekday: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()],
    };
  });
}

export function monthRange(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { from: localDateKey(start), to: localDateKey(end) };
}

export function dateTimeForEntry(dateKey: string, original = new Date()): string {
  const date = parseLocalDateKey(dateKey);
  date.setHours(original.getHours(), original.getMinutes(), 0, 0);
  return date.toISOString();
}

export function entryDateKey(entry: MoodJournalEntry): string {
  return localDateKey(new Date(entry.occurred_at));
}

export function entryTime(entry: MoodJournalEntry): string {
  const date = new Date(entry.occurred_at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function entryMoodText(entry: MoodJournalEntry): string {
  const parts = [entry.mood_level ? moodLabels[entry.mood_level] : null, ...entry.emotion_words];
  return parts.filter(Boolean).join(' · ');
}

export function formatMoodDate(dateKey: string): string {
  const date = parseLocalDateKey(dateKey);
  const today = localDateKey(new Date());
  if (dateKey === today) return '今天';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function groupEntriesByDate(entries: MoodJournalEntry[]) {
  const groups: { date: string; entries: MoodJournalEntry[] }[] = [];
  for (const entry of entries) {
    const date = entryDateKey(entry);
    const group = groups.at(-1);
    if (group?.date === date) group.entries.push(entry);
    else groups.push({ date, entries: [entry] });
  }
  return groups;
}
