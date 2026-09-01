import type { Event, ReminderInput, UpdateEventRequest } from '@steward/api-client';

export type EventEditDraft = {
  title: string;
  allDay: boolean;
  start: string;
  end: string;
  timezone: string;
  location: string;
  participants: string;
  projectId: string;
  note: string;
  reminderEnabled: boolean;
  reminderOption: 'at_time' | '10m' | '1h' | '1d';
  reminderTime: string;
};

export function eventEditDraft(event: Event): EventEditDraft {
  const reminder = event.reminders?.[0];
  return {
    title: event.title,
    allDay: event.all_day,
    start: event.all_day ? event.start_date ?? '' : event.start_at ? formatLocalDateTime(event.start_at) : '',
    end: event.all_day ? event.end_date ?? '' : event.end_at ? formatLocalDateTime(event.end_at) : '',
    timezone: event.timezone,
    location: event.location ?? '',
    participants: (event.participants ?? []).join('，'),
    projectId: event.project_id ?? '',
    note: event.note ?? '',
    reminderEnabled: Boolean(reminder),
    reminderOption: reminder?.offset_minutes === -60 ? '1h' : reminder?.offset_minutes === -1440 ? '1d' : reminder?.offset_minutes === 0 ? 'at_time' : '10m',
    reminderTime: reminder?.local_time ?? '09:00',
  };
}

export function buildEventEditRequest(draft: EventEditDraft): UpdateEventRequest {
  const title = draft.title.trim();
  if (!title) throw new Error('日程标题不能为空');
  if (!draft.timezone.trim()) throw new Error('时区不能为空');
  const clear: NonNullable<UpdateEventRequest['clear']> = [];
  const request: UpdateEventRequest = {
    title,
    all_day: draft.allDay,
    timezone: draft.timezone.trim(),
  };

  if (draft.allDay) {
    if (!isDate(draft.start)) throw new Error('开始日期请使用 YYYY-MM-DD');
    if (draft.end && !isDate(draft.end)) throw new Error('结束日期请使用 YYYY-MM-DD');
    if (draft.end && draft.end < draft.start) throw new Error('结束日期不能早于开始日期');
    request.start_date = draft.start;
    if (draft.end) request.end_date = draft.end; else clear.push('end_date');
    clear.push('start_at', 'end_at');
  } else {
    request.start_at = parseZonedLocalDateTime(draft.start, draft.timezone);
    if (draft.end) {
      request.end_at = parseZonedLocalDateTime(draft.end, draft.timezone);
      if (new Date(request.end_at).getTime() <= new Date(request.start_at).getTime()) {
        throw new Error('结束时间必须晚于开始时间');
      }
    } else clear.push('end_at');
    clear.push('start_date', 'end_date');
  }

  assign(request, clear, 'location', draft.location);
  assign(request, clear, 'project_id', draft.projectId);
  assign(request, clear, 'note', draft.note);
  const people = draft.participants.split(/[，,]/).map(value => value.trim()).filter(Boolean);
  if (people.length) request.participants = [...new Set(people)]; else clear.push('participants');

  if (draft.reminderEnabled) {
    if (draft.allDay && !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.reminderTime)) {
      throw new Error('提醒时刻请使用 HH:mm');
    }
    const reminder: ReminderInput = draft.allDay
      ? { kind: 'absolute_local', days_before: 0, local_time: draft.reminderTime }
      : { kind: 'relative', offset_minutes: reminderOffset(draft.reminderOption) };
    request.reminders = [reminder];
  } else clear.push('reminders');
  request.clear = [...new Set(clear)];
  return request;
}

function reminderOffset(option: EventEditDraft['reminderOption']) {
  if (option === 'at_time') return 0;
  if (option === '1h') return -60;
  if (option === '1d') return -1440;
  return -10;
}

function assign(
  request: UpdateEventRequest,
  clear: NonNullable<UpdateEventRequest['clear']>,
  field: 'location' | 'project_id' | 'note',
  value: string,
) {
  const trimmed = value.trim();
  if (trimmed) request[field] = trimmed;
  else clear.push(field);
}

function isDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

export function parseZonedLocalDateTime(value: string, timezone: string): string {
  const normalized = value.trim().replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)) throw new Error('时间请使用 YYYY-MM-DD HH:mm');
  const [datePart, timePart] = normalized.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  let instant = Date.UTC(year, month - 1, day, hour, minute);
  try {
    // Intl 没有直接的「当地墙上时间 → UTC」API；用两轮偏移校正处理跨日与 DST。
    for (let index = 0; index < 2; index += 1) {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(new Date(instant));
      const read = (type: string) => Number(parts.find(part => part.type === type)?.value);
      const rendered = Date.UTC(read('year'), read('month') - 1, read('day'), read('hour'), read('minute'));
      instant += Date.UTC(year, month - 1, day, hour, minute) - rendered;
    }
  } catch { throw new Error('时区无效'); }
  return new Date(instant).toISOString();
}

function formatLocalDateTime(value: string): string {
  const date = new Date(value);
  const part = (number: number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())} ${part(date.getHours())}:${part(date.getMinutes())}`;
}
