import type { Note } from '@steward/api-client';

const MINIMUM_AGE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 从真实笔记中稳定选出当天的一条“重新遇见”。
 *
 * 首版不在客户端假装做语义理解：这里只执行可解释的时间筛选，
 * AI 深入讨论由用户点击“继续想想”后交给正式 Assistant。
 */
export function selectDailyInspirationNote(
  notes: readonly Note[],
  localDate: string,
): Note | null {
  const today = parseLocalDate(localDate);
  if (!today) return null;

  const cutoff = today.getTime() - MINIMUM_AGE_DAYS * DAY_MS;
  const eligible = notes
    .filter((note) => !note.deleted_at && Date.parse(note.updated_at) <= cutoff)
    .sort((left, right) => {
      const byUpdatedAt = Date.parse(left.updated_at) - Date.parse(right.updated_at);
      return byUpdatedAt || left.id.localeCompare(right.id);
    });

  if (eligible.length === 0) return null;
  return eligible[stableDayNumber(today) % eligible.length] ?? null;
}

function parseLocalDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const result = new Date(year, month - 1, day);
  if (
    result.getFullYear() !== year
    || result.getMonth() !== month - 1
    || result.getDate() !== day
  ) return null;
  return result;
}

function stableDayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}
