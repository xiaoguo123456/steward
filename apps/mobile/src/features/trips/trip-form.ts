import type { CreateProjectRequest } from '@steward/api-client';

export type TripDraft = {
  title: string;
  destination: string;
  startDate: string;
  endDate: string;
  notes: string;
};

export function validateTripDraft(draft: TripDraft): string | null {
  if (!draft.title.trim()) return '请填写行程名称';
  if (!draft.destination.trim()) return '请填写目的地';
  if (!draft.startDate) return '请选择开始日期';
  if (!draft.endDate) return '请选择结束日期';
  if (draft.endDate < draft.startDate) return '结束日期不能早于开始日期';
  return null;
}

export function buildTripRequest(draft: TripDraft): CreateProjectRequest {
  const destination = draft.destination.trim();
  const notes = draft.notes.trim();

  return {
    title: draft.title.trim(),
    description: notes ? `${destination}\n${notes}` : destination,
    start_date: draft.startDate,
    target_date: draft.endDate,
    project_kind: 'trip',
  };
}

export function parseTripDescription(description?: string | null): {
  destination: string;
  notes: string;
} {
  const [destination = '', ...noteLines] = (description ?? '').split('\n');
  return {
    destination: destination.trim(),
    notes: noteLines.join('\n').trim(),
  };
}

export function toLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addCalendarDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function formatTripDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${year}年${Number(month)}月${Number(day)}日`;
}

const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function formatTripDateWithWeekday(value: string): string {
  const date = parseLocalDate(value);
  return `${formatTripDate(value)} ${weekdayNames[date.getDay()]}`;
}

export function tripDurationDays(startDate: string, endDate: string): number {
  if (!startDate || !endDate || endDate < startDate) return 0;
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

export function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}
