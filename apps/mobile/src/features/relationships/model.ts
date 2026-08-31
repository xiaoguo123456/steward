import type {
  Event,
  PersonInteractionType,
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

export const interactionTypeOptions: readonly { id: PersonInteractionType; label: string }[] = [
  { id: 'met', label: '见面' },
  { id: 'call', label: '通话' },
  { id: 'message', label: '消息' },
  { id: 'meal', label: '聚餐' },
  { id: 'gift', label: '礼物' },
  { id: 'other', label: '其他' },
];

export const interactionTypeLabels: Record<PersonInteractionType, string> = {
  met: '见面',
  call: '通话',
  message: '消息',
  meal: '聚餐',
  gift: '礼物',
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
  if (event.start_date) {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'long',
      day: 'numeric',
    }).format(new Date(`${event.start_date}T12:00:00`));
  }
  if (event.start_at) {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(event.start_at));
  }
  return '';
}

export function formatInteractionTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
