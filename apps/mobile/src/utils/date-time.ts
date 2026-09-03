export type ZonedDateTimeParts = {
  date: string;
  hour: number;
  minute: number;
};

/**
 * 把绝对时间转换为指定 IANA 时区中的日期与分钟。
 * 这里只服务展示和布局；日期归属仍以服务端 Calendar 日期桶为准。
 */
export function zonedDateTimeParts(value: string | Date, timezone?: string): ZonedDateTimeParts | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      ...(timezone ? { timeZone: timezone } : {}),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const read = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value;
    const year = read('year');
    const month = read('month');
    const day = read('day');
    const hour = Number(read('hour'));
    const minute = Number(read('minute'));
    if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute)) return null;
    return { date: `${year}-${month}-${day}`, hour, minute };
  } catch {
    return null;
  }
}

/** 输出不含秒的「YYYY/M/D HH:mm」。 */
export function formatMinuteDateTime(value: string | Date, timezone?: string): string {
  const parts = zonedDateTimeParts(value, timezone);
  if (!parts) return '';
  const [year, month, day] = parts.date.split('-').map(Number);
  return `${year}/${month}/${day} ${formatMinuteClock(parts.hour * 60 + parts.minute)}`;
}

/** 输出不含秒的「HH:mm」。 */
export function formatMinuteClock(totalMinutes: number): string {
  const normalized = Math.max(0, Math.min(24 * 60, Math.round(totalMinutes)));
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
