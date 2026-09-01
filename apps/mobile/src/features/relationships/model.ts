import type {
  Event,
  RelationshipGroup,
} from '@steward/api-client';

export const relationshipGroupOptions: readonly { id: RelationshipGroup; label: string }[] = [
  { id: 'family', label: '家人' },
  { id: 'friend', label: '朋友' },
  { id: 'colleague', label: '同事' },
  { id: 'other', label: '其他' },
];

export const relationshipGroupLabels: Record<RelationshipGroup, string> = {
  family: '家人',
  friend: '朋友',
  colleague: '同事',
  other: '其他',
};

export function localDate(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function localTime(value = new Date()) {
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
}

export function localDateTimeISO(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString();
}

export function eventTimestamp(event: Event) {
  if (event.start_at) return new Date(event.start_at).getTime();
  if (event.start_date) return new Date(`${event.start_date}T23:59:59`).getTime();
  return 0;
}

export function formatEventTime(event: Event) {
  const value = event.start_date
    ? new Date(`${event.start_date}T12:00:00`)
    : event.start_at
      ? new Date(event.start_at)
      : null;
  if (!value || Number.isNaN(value.getTime())) return '';
  const date = `${value.getMonth() + 1}月${value.getDate()}日`;
  if (event.start_date) return date;
  const time = `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
  return `${date} ${time}`;
}
