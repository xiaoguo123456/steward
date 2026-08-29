export type InspirationPrompt = {
  id: string;
  theme: string;
  question: string;
  nudge: string;
};

const DAILY_PROMPTS: readonly InspirationPrompt[] = [
  {
    id: 'unfinished-thought',
    theme: '放在心上',
    question: '最近有什么事，你明明很在意，却一直没认真想过？',
    nudge: '不用急着解决，先把它完整地说出来。',
  },
  {
    id: 'one-important-thing',
    theme: '真正重要',
    question: '如果这周只能完成一件真正重要的事，会是什么？',
    nudge: '先把其他声音放低一点。',
  },
  {
    id: 'changing-moment',
    theme: '正在改变',
    question: '最近哪个瞬间，让你觉得自己正在改变？',
    nudge: '回到那个具体瞬间，而不是急着总结。',
  },
  {
    id: 'keep-a-moment',
    theme: '留住此刻',
    question: '今天发生的哪一刻，你想在以后重新看到？',
    nudge: '一句话就够，细节可以以后再补。',
  },
  {
    id: 'follow-curiosity',
    theme: '保持好奇',
    question: '最近有什么问题，让你忍不住想继续了解？',
    nudge: '先跟着好奇心走一小段。',
  },
  {
    id: 'say-it-aloud',
    theme: '说出来',
    question: '有什么想法，你一直没有好好说出来？',
    nudge: '可以从最难说的那一句开始。',
  },
  {
    id: 'another-way',
    theme: '换种做法',
    question: '哪件事如果换一种做法，可能会更轻松？',
    nudge: '不必推翻全部，只找一个可以改变的环节。',
  },
];

/** 按当地日期稳定轮换四个不同方向，首项是当天默认主题。 */
export function selectDailyPrompts(localDate: string): InspirationPrompt[] {
  const start = dailyPromptIndex(localDate);
  return Array.from(
    { length: 4 },
    (_, index) => DAILY_PROMPTS[(start + index) % DAILY_PROMPTS.length] ?? DAILY_PROMPTS[0],
  );
}

/** 没有历史内容时按当地日期稳定给出一个可直接回答的问题。 */
export function selectDailyPrompt(localDate: string): string {
  return selectDailyPrompts(localDate)[0]?.question ?? DAILY_PROMPTS[0].question;
}

function dailyPromptIndex(localDate: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) return 0;

  const [, year, month, day] = match;
  const dayNumber = Math.floor(Date.UTC(Number(year), Number(month) - 1, Number(day)) / 86_400_000);
  return dayNumber % DAILY_PROMPTS.length;
}
