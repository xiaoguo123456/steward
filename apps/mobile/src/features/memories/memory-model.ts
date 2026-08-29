export type MemoryPhotoSource = number | { uri: string };

export type MemoryPhoto = {
  id: string;
  source: MemoryPhotoSource;
  description: string;
};

export type MemoryMoment = {
  id: string;
  date: string;
  title: string;
  story: string;
  photos: MemoryPhoto[];
  origin: 'demo' | 'local';
};

export type MemoryMonthGroup = {
  key: string;
  year: number;
  month: number;
  label: string;
  moments: MemoryMoment[];
};

export type MemoryWritingCandidate = {
  title: string;
  story: string;
  sourceSummary: string;
};

/** 时光首页以月份分组；同一天允许多条，组内保持由新到旧。 */
export function groupMemoryMoments(moments: readonly MemoryMoment[]): MemoryMonthGroup[] {
  const sorted = [...moments].sort((left, right) => {
    const byDate = right.date.localeCompare(left.date);
    return byDate === 0 ? right.id.localeCompare(left.id) : byDate;
  });
  const groups = new Map<string, MemoryMonthGroup>();

  for (const moment of sorted) {
    const [year, month] = moment.date.split('-').map(Number);
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const existing = groups.get(key);
    if (existing) {
      existing.moments.push(moment);
      continue;
    }
    groups.set(key, {
      key,
      year,
      month,
      label: `${month}月`,
      moments: [moment],
    });
  }

  return [...groups.values()];
}

export function memoriesForDate(
  moments: readonly MemoryMoment[],
  date: string,
): MemoryMoment[] {
  return moments.filter((moment) => moment.date === date);
}

export function memoryDatesWithCounts(moments: readonly MemoryMoment[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const moment of moments) counts.set(moment.date, (counts.get(moment.date) ?? 0) + 1);
  return counts;
}

export function formatMemoryDateParts(date: string): {
  day: string;
  weekday: string;
  month: string;
  full: string;
} {
  const target = parseDateKey(date);
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const month = `${target.getMonth() + 1}月`;
  const day = String(target.getDate()).padStart(2, '0');
  return {
    day,
    weekday: weekdays[target.getDay()],
    month,
    full: `${target.getFullYear()}年${month}${target.getDate()}日 · ${weekdays[target.getDay()]}`,
  };
}

/**
 * 当前原型的确定性文案 Candidate。
 * 它只验证“建议—采用—保存”的产品路径，不把图片发送给模型，也不冒充正式 AI。
 */
export function buildPrototypeWritingCandidate(input: {
  date: string;
  photoCount: number;
  title: string;
  story: string;
}): MemoryWritingCandidate {
  const date = formatMemoryDateParts(input.date);
  const title = input.title.trim() || `${date.month}${Number(date.day)}日的片段`;
  const story = input.story.trim()
    ? `${input.story.trim()} 这 ${input.photoCount} 张照片，把那天的光和心情留了下来。`
    : `翻到这 ${input.photoCount} 张照片，才发现普通的一天也有值得记住的光。`;

  return {
    title,
    story,
    sourceSummary: `${input.photoCount} 张已选照片 · ${input.date}`,
  };
}

export function isMemoryDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = parseDateKey(value);
  return formatDateKey(parsed) === value;
}

export function todayMemoryDateKey(): string {
  return formatDateKey(new Date());
}

function parseDateKey(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

function formatDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}
