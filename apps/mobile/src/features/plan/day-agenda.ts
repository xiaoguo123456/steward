import type { Event, TodayTask, TodayView } from '@steward/api-client';
import { formatMinuteClock, formatMinuteDateTime, zonedDateTimeParts } from '../../utils/date-time';

export type AgendaItem =
  | { kind: 'task'; key: string; item: TodayTask }
  | { kind: 'event'; key: string; event: Event };

/** 只组合服务端已收录的结果；保留两类各自的权威顺序，不在客户端判断日期或状态。 */
export function dayAgendaItems(view?: Pick<TodayView, 'tasks' | 'events'>): AgendaItem[] {
  if (!view) return [];
  return [
    ...view.tasks.map((item): AgendaItem => ({ kind: 'task', key: `task:${item.task.id}`, item })),
    ...view.events.map((event): AgendaItem => ({ kind: 'event', key: `event:${event.id}`, event })),
  ];
}

/** 数量和展示共用同一份实体集合，不使用仅统计任务的旧 counts.total。 */
export function dayAgendaCount(view?: Pick<TodayView, 'tasks' | 'events'>): number {
  return view ? view.tasks.length + view.events.length : 0;
}

/** 只格式化服务端已选定日程的时间，跨日时显式保留日期，避免把续日显示成当天新开始。 */
export function agendaEventTime(event: Event, timezone: string, date: string): string {
  if (event.all_day) return '全天';
  const start = event.start_at ? zonedDateTimeParts(event.start_at, timezone) : null;
  if (!start) return '';
  const first = start.date === date
    ? formatMinuteClock(start.hour * 60 + start.minute)
    : formatMinuteDateTime(event.start_at!, timezone);
  const end = event.end_at ? zonedDateTimeParts(event.end_at, timezone) : null;
  if (!end) return first;
  const last = end.date === date
    ? formatMinuteClock(end.hour * 60 + end.minute)
    : formatMinuteDateTime(event.end_at!, timezone);
  return `${first}–${last}`;
}
