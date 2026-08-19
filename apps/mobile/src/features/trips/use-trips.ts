import {
  useGetProjectItinerary,
  useListProjects,
  useUpdateTask,
  type Event,
  type Project,
  type ProjectItinerary,
} from '@steward/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { colors } from '@/theme/tokens';
import { formatClock } from '@/utils/format';

import type { TripAgendaItem, TripBooking, TripChecklistItem, TripDay, TripPlan } from './trip-data';

/**
 * 行程的数据层。
 *
 * 行程不是新的领域类型：它是 project_kind=trip 的 Project，
 * 把 Event、Task 和 Note 组织在一起。按天分组与日期范围由服务端
 * 按用户时区算好——同一次行程跨时区时，「哪天」只有服务端能给出一致答案。
 */

const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 行程总览。只需要项目本身的信息，不用为每条行程都拉一次聚合。 */
export function useTripsOverview() {
  const projects = useListProjects({
    project_kind: 'trip',
    status: ['active', 'paused', 'completed'],
    limit: 50,
  });

  const trips = useMemo(
    () => (projects.data?.data ?? []).map(toTripSummary),
    [projects.data],
  );

  return {
    upcoming: trips.filter((trip) => trip.status === 'upcoming'),
    completed: trips.filter((trip) => trip.status === 'completed'),
    loading: projects.isLoading,
  };
}

/** 单次行程详情。 */
export function useTripDetail(projectId: string) {
  const queryClient = useQueryClient();
  const itinerary = useGetProjectItinerary(projectId, {
    query: { enabled: Boolean(projectId) },
  });

  const toggleTask = useUpdateTask({
    mutation: {
      onSuccess: () => {
        void itinerary.refetch();
        void queryClient.invalidateQueries();
      },
    },
  });

  const trip = useMemo(
    () => (itinerary.data ? toTripPlan(itinerary.data.data) : null),
    [itinerary.data],
  );

  return {
    trip,
    loading: itinerary.isLoading,
    notFound: itinerary.isError,
    toggleChecklistItem: (taskId: string, completed: boolean) => {
      toggleTask.mutate({ taskId, data: { status: completed ? 'done' : 'todo' } });
    },
  };
}

function toTripSummary(project: Project): TripPlan {
  const completed = project.status === 'completed' || project.status === 'archived';
  return {
    id: project.id,
    title: project.title,
    // 目的地没有独立字段：它就是项目描述的第一行。
    destination: (project.description ?? '').split('\n')[0] ?? '',
    dateRange: formatDateRange(project.start_date, project.target_date),
    duration: formatDuration(project.start_date, project.target_date),
    status: completed ? 'completed' : 'upcoming',
    statusLabel: completed ? '已完成' : '进行中',
    statusTone: completed ? 'neutral' : 'primary',
    days: [],
    bookings: [],
    checklist: [],
  };
}

function toTripPlan(itinerary: ProjectItinerary): TripPlan {
  const summary = toTripSummary(itinerary.project);
  return {
    ...summary,
    dateRange: formatDateRange(
      itinerary.start_date ?? itinerary.project.start_date,
      itinerary.end_date ?? itinerary.project.target_date,
    ),
    duration: formatDuration(
      itinerary.start_date ?? itinerary.project.start_date,
      itinerary.end_date ?? itinerary.project.target_date,
    ),
    days: itinerary.days.map(toTripDay),
    // 预订资料就是带地点的日程：交通与住宿本来就是有时间有地点的事。
    bookings: itinerary.days
      .flatMap((day) => day.events)
      .filter((event) => event.location)
      .map(toBooking),
    checklist: itinerary.tasks.map(toChecklistItem),
  };
}

function toTripDay(day: ProjectItinerary['days'][number]): TripDay {
  const date = new Date(day.date);
  return {
    id: day.date,
    date: `${date.getMonth() + 1}月${date.getDate()}日`,
    weekday: weekdayNames[date.getDay()],
    label: '',
    agenda: day.events.map(toAgendaItem),
  };
}

function toAgendaItem(event: Event): TripAgendaItem {
  return {
    id: event.id,
    time: event.all_day ? '全天' : formatClock(new Date(event.start_at ?? '')),
    title: event.title,
    meta: event.location ?? '',
    icon: 'calendar-outline',
    color: colors.primaryStrong,
    soft: colors.primarySoft,
  };
}

function toBooking(event: Event): TripBooking {
  return {
    id: event.id,
    title: event.title,
    meta: event.location ?? '',
    // 预订状态没有独立字段，也不该在这里编一个：日程存在就说明已经定下来了。
    status: '已确认',
    icon: 'bookmark-outline',
    color: colors.primaryStrong,
    soft: colors.primarySoft,
  };
}

function toChecklistItem(task: ProjectItinerary['tasks'][number]): TripChecklistItem {
  return {
    id: task.id,
    title: task.title,
    meta: task.description ?? undefined,
    completed: task.status === 'done',
  };
}

function formatDateRange(start?: string | null, end?: string | null): string {
  if (!start) return '未设置日期';
  const from = new Date(start);
  const head = `${from.getMonth() + 1}月${from.getDate()}日`;
  if (!end || end === start) return head;
  const to = new Date(end);
  return `${head} — ${to.getMonth() + 1}月${to.getDate()}日`;
}

function formatDuration(start?: string | null, end?: string | null): string {
  if (!start || !end) return '';
  const days =
    Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000) + 1;
  return days > 0 ? `${days} 天` : '';
}
