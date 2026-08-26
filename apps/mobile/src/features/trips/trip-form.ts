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
