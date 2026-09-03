import type { CalendarDay, Event, Task } from '@steward/api-client';

import { formatMinuteClock, zonedDateTimeParts } from '../../utils/date-time';

export type WeekTimelineItem = {
  id: string;
  instanceKey: string;
  type: 'event' | 'important' | 'task';
  title: string;
  date: string;
  dayIndex: number;
  startMinute: number;
  endMinute: number;
  column: number;
  columnCount: number;
  timeLabel: string;
};

export type WeekAllDayItem = {
  id: string;
  instanceKey: string;
  type: WeekTimelineItem['type'];
  title: string;
  date: string;
  dayIndex: number;
};

export type WeekTimeline = {
  timed: WeekTimelineItem[];
  allDay: WeekAllDayItem[];
  initialMinute: number;
};

type WeekCell = { date: string };

const DEFAULT_EVENT_MINUTES = 60;
const DEFAULT_TASK_MINUTES = 30;

/**
 * 把服务端已经确定日期归属的一周数据转换成七列时间轴。
 * 跨午夜事项会按当地日期切段；重叠事项只改变展示列，不改变服务端排序和事实。
 */
export function buildWeekTimeline(
  cells: WeekCell[],
  daysByDate: Map<string, CalendarDay>,
  timezone: string,
): WeekTimeline {
  const timed: WeekTimelineItem[] = [];
  const allDay: WeekAllDayItem[] = [];
  const events = uniqueByID(cells.flatMap(cell => daysByDate.get(cell.date)?.events ?? []));
  const tasks = uniqueByID(cells.flatMap(cell => daysByDate.get(cell.date)?.tasks ?? []));

  for (const event of events) appendEvent(event, cells, timezone, timed, allDay);
  for (const task of tasks) appendTask(task, cells, daysByDate, timezone, timed, allDay);

  layoutOverlaps(timed);
  timed.sort((left, right) => left.dayIndex - right.dayIndex || left.startMinute - right.startMinute || left.title.localeCompare(right.title, 'zh-CN'));
  allDay.sort((left, right) => left.dayIndex - right.dayIndex);

  const earliest = timed.reduce((value, item) => Math.min(value, item.startMinute), Number.POSITIVE_INFINITY);
  const initialMinute = Number.isFinite(earliest)
    ? Math.max(0, Math.min(18 * 60, Math.floor((earliest - 60) / 60) * 60))
    : 7 * 60;
  return { timed, allDay, initialMinute };
}

function appendEvent(
  event: Event,
  cells: WeekCell[],
  timezone: string,
  timed: WeekTimelineItem[],
  allDay: WeekAllDayItem[],
) {
  const type = event.event_kind === 'important_date' ? 'important' as const : 'event' as const;
  if (event.all_day || !event.start_at) {
    const startDate = event.start_date ?? cells.find(cell => cell.date)?.date;
    if (!startDate) return;
    const endDate = event.end_date ?? startDate;
    appendAllDayRange(event.id, event.title, type, startDate, endDate, cells, allDay);
    return;
  }
  appendTimedRange(event.id, event.title, type, event.start_at, event.end_at, DEFAULT_EVENT_MINUTES, cells, timezone, timed);
}

function appendTask(
  task: Task,
  cells: WeekCell[],
  daysByDate: Map<string, CalendarDay>,
  timezone: string,
  timed: WeekTimelineItem[],
  allDay: WeekAllDayItem[],
) {
  const start = task.scheduled_start_at ?? task.due_at;
  if (start) {
    appendTimedRange(
      task.id,
      task.title,
      'task',
      start,
      task.scheduled_start_at ? task.scheduled_end_at : null,
      task.scheduled_start_at ? task.estimated_minutes ?? DEFAULT_TASK_MINUTES : DEFAULT_TASK_MINUTES,
      cells,
      timezone,
      timed,
    );
    return;
  }
  const date = cells.find(cell => daysByDate.get(cell.date)?.tasks.some(item => item.id === task.id))?.date;
  if (date) appendAllDayRange(task.id, task.title, 'task', date, date, cells, allDay);
}

function appendAllDayRange(
  id: string,
  title: string,
  type: WeekTimelineItem['type'],
  startDate: string,
  endDate: string,
  cells: WeekCell[],
  target: WeekAllDayItem[],
) {
  cells.forEach((cell, dayIndex) => {
    if (cell.date < startDate || cell.date > endDate) return;
    target.push({ id, instanceKey: `${id}:${cell.date}:all-day`, type, title, date: cell.date, dayIndex });
  });
}

function appendTimedRange(
  id: string,
  title: string,
  type: WeekTimelineItem['type'],
  startValue: string,
  endValue: string | null | undefined,
  defaultMinutes: number,
  cells: WeekCell[],
  timezone: string,
  target: WeekTimelineItem[],
) {
  const start = zonedDateTimeParts(startValue, timezone);
  if (!start) return;
  const startInstant = new Date(startValue).getTime();
  const suppliedEndInstant = endValue ? new Date(endValue).getTime() : Number.NaN;
  const hasSuppliedEnd = Number.isFinite(suppliedEndInstant) && suppliedEndInstant > startInstant;
  const endInstant = hasSuppliedEnd
    ? suppliedEndInstant
    : startInstant + defaultMinutes * 60_000;
  const end = zonedDateTimeParts(new Date(endInstant), timezone);
  if (!end) return;

  cells.forEach((cell, dayIndex) => {
    const beginsBeforeEnd = cell.date < end.date || (cell.date === end.date && end.hour * 60 + end.minute > 0);
    if (cell.date < start.date || !beginsBeforeEnd) return;
    const rawStart = cell.date === start.date ? start.hour * 60 + start.minute : 0;
    const rawEnd = cell.date === end.date ? end.hour * 60 + end.minute : 24 * 60;
    if (rawEnd <= rawStart) return;
    target.push({
      id,
      instanceKey: `${id}:${cell.date}:${rawStart}`,
      type,
      title,
      date: cell.date,
      dayIndex,
      startMinute: rawStart,
      endMinute: rawEnd,
      column: 0,
      columnCount: 1,
      timeLabel: hasSuppliedEnd
        ? `${formatMinuteClock(rawStart)}–${formatMinuteClock(rawEnd)}`
        : formatMinuteClock(rawStart),
    });
  });
}

function layoutOverlaps(items: WeekTimelineItem[]) {
  const byDate = new Map<string, WeekTimelineItem[]>();
  for (const item of items) byDate.set(item.date, [...(byDate.get(item.date) ?? []), item]);

  for (const dayItems of byDate.values()) {
    dayItems.sort((left, right) => left.startMinute - right.startMinute || right.endMinute - left.endMinute);
    let cluster: WeekTimelineItem[] = [];
    let clusterEnd = -1;
    const finishCluster = () => {
      if (cluster.length === 0) return;
      const laneEnds: number[] = [];
      for (const item of cluster) {
        let lane = laneEnds.findIndex(end => end <= item.startMinute);
        if (lane < 0) lane = laneEnds.length;
        laneEnds[lane] = item.endMinute;
        item.column = lane;
      }
      for (const item of cluster) item.columnCount = laneEnds.length;
      cluster = [];
    };

    for (const item of dayItems) {
      if (cluster.length > 0 && item.startMinute >= clusterEnd) finishCluster();
      cluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.endMinute);
    }
    finishCluster();
  }
}

function uniqueByID<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map(item => [item.id, item])).values()];
}
