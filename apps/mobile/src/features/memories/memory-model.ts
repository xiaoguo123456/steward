import type { MemoryMoment as ApiMemoryMoment } from '@steward/api-client';

export type MemoryPhotoSource = number | { uri: string };

export type MemoryPhoto = {
  id: string;
  source: MemoryPhotoSource;
  description: string;
  local?: {
    uri: string;
    contentType: string;
    byteSize?: number;
  };
};

export type MemoryMoment = {
  id: string;
  date: string;
  description: string;
  photos: MemoryPhoto[];
};

export type MemoryMonthGroup = {
  key: string;
  year: number;
  month: number;
  label: string;
  moments: MemoryMoment[];
};

/** 把生成的网络 DTO 映射为只负责展示的移动端视图模型。 */
export function toMemoryMoment(moment: ApiMemoryMoment): MemoryMoment {
  return {
    id: moment.id,
    date: moment.occurred_on,
    description: moment.description,
    photos: [...moment.photos]
      .sort((left, right) => left.position - right.position)
      .map((photo) => ({
        id: photo.media_id,
        source: { uri: photo.read_url },
        description: photo.description,
      })),
  };
}

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

export function isMemoryDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = parseDateKey(value);
  return formatDateKey(parsed) === value;
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
