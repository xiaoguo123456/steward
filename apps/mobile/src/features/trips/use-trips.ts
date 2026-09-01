import {
  useGetProjectItinerary,
  useListProjects,
  updateTask,
  isApiError,
  type Event,
  type Project,
  type ProjectItinerary,
} from '@steward/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { colors } from '@/theme/tokens';
import { formatClock } from '@/utils/format';

import type { TripAgendaItem, TripBooking, TripChecklistItem, TripDay, TripPlan } from './trip-data';
import { parseLocalDate, parseTripDescription, toLocalIsoDate } from './trip-form';

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
    failed: projects.isError,
    error: projects.error,
    refetch: projects.refetch,
  };
}

/** 单次行程详情。 */
export function useTripDetail(projectId: string) {
  const queryClient = useQueryClient();
  const itinerary = useGetProjectItinerary(projectId, {
    query: { enabled: Boolean(projectId) },
  });

  const toggleTask = useMutation({
    mutationFn: ({ task, completed }: { task: TripChecklistItem; completed: boolean }) =>
      updateTask(
        task.id,
        { status: completed ? 'done' : 'todo' },
        { headers: { 'If-Match': String(task.version) } },
      ),
    onSuccess: () => {
      void itinerary.refetch();
      void queryClient.invalidateQueries();
    },
  });

  const trip = useMemo(
    () => (itinerary.data ? toTripPlan(itinerary.data.data) : null),
    [itinerary.data],
  );

  return {
    trip,
    loading: itinerary.isLoading,
    failed: itinerary.isError && !(isApiError(itinerary.error) && itinerary.error.status === 404),
    error: itinerary.error,
    notFound: isApiError(itinerary.error) && itinerary.error.status === 404,
    refetch: itinerary.refetch,
    toggleError: toggleTask.error,
    toggleChecklistItem: async (taskId: string, completed: boolean) => {
      const task = trip?.checklist.find((item) => item.id === taskId);
      if (!task) return;
      await toggleTask.mutateAsync({ task, completed });
    },
  };
}

function toTripSummary(project: Project): TripPlan {
  const completed = project.status === 'completed' || project.status === 'archived';
  const description = parseTripDescription(project.description);
  return {
    id: project.id,
    title: project.title,
    // 目的地没有独立字段：项目描述第一行是目的地，余下内容是注意事项。
    destination: description.destination,
    notes: description.notes,
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
      itinerary.project.start_date ?? itinerary.start_date,
      itinerary.project.target_date ?? itinerary.end_date,
    ),
    duration: formatDuration(
      itinerary.project.start_date ?? itinerary.start_date,
      itinerary.project.target_date ?? itinerary.end_date,
    ),
    days: buildTripDays(itinerary),
    // 预订只来自明确标记为交通或住宿的 Event，不再根据“有地点”猜测。
    bookings: itinerary.days
      .flatMap((day) => day.events)
      .filter((event) => event.itinerary_details?.kind === 'transport'
        || event.itinerary_details?.kind === 'lodging')
      .map(toBooking),
    checklist: itinerary.tasks.map(toChecklistItem),
  };
}

function buildTripDays(itinerary: ProjectItinerary): TripDay[] {
  const start = itinerary.project.start_date ?? itinerary.start_date;
  const end = itinerary.project.target_date ?? itinerary.end_date;
  if (!start || !end) return itinerary.days.map(toTripDay);

  const eventsByDate = new Map(itinerary.days.map((day) => [day.date, day.events]));
  const current = parseLocalDate(start);
  const last = parseLocalDate(end);
  const days: TripDay[] = [];
  // 防止异常数据让客户端生成无限日期；一年已足够覆盖当前行程产品范围。
  for (let index = 0; current <= last && index < 366; index += 1) {
    const date = toLocalIsoDate(current);
    days.push(toTripDay({ date, events: eventsByDate.get(date) ?? [] }));
    current.setDate(current.getDate() + 1);
  }
  return days;
}

function toTripDay(day: ProjectItinerary['days'][number]): TripDay {
  const date = parseLocalDate(day.date);
  return {
    id: day.date,
    date: `${date.getMonth() + 1}月${date.getDate()}日`,
    weekday: weekdayNames[date.getDay()],
    label: '',
    agenda: day.events.map(toAgendaItem),
  };
}

function toAgendaItem(event: Event): TripAgendaItem {
  const details = event.itinerary_details;
  const visual = itineraryVisual(details?.kind, details?.transport_mode);
  const route = details?.kind === 'transport' && details.origin && details.destination
    ? `${details.origin} — ${details.destination}`
    : undefined;
  return {
    id: event.id,
    time: event.all_day ? '全天' : formatClock(new Date(event.start_at ?? '')),
    title: event.title,
    endTime: event.end_at ? formatClock(new Date(event.end_at)) : undefined,
    route,
    meta: route ?? event.location ?? '',
    icon: visual.icon,
    color: visual.color,
    soft: visual.soft,
  };
}

function toBooking(event: Event): TripBooking {
  const details = event.itinerary_details;
  const kind = details?.kind === 'lodging' ? 'lodging' : 'transport';
  const visual = itineraryVisual(kind, details?.transport_mode);
  const route = details?.origin && details.destination
    ? `${details.origin} — ${details.destination}`
    : event.location ?? '';
  return {
    id: event.id,
    title: event.title,
    meta: [details?.service_number, route].filter(Boolean).join(' · '),
    status: bookingStatusLabel(details?.booking_status),
    kind,
    startAt: event.start_at,
    endAt: event.end_at,
    location: event.location ?? undefined,
    origin: details?.origin ?? undefined,
    destination: details?.destination ?? undefined,
    serviceNumber: details?.service_number ?? undefined,
    seat: details?.seat ?? undefined,
    attachmentMediaIds: details?.attachment_media_ids ?? [],
    icon: visual.icon,
    color: visual.color,
    soft: visual.soft,
  };
}

function itineraryVisual(kind?: string, transportMode?: string | null) {
  if (kind === 'transport') {
    const icon = transportMode === 'flight'
      ? 'airplane-outline' as const
      : transportMode === 'coach'
        ? 'bus-outline' as const
        : transportMode === 'ship'
          ? 'boat-outline' as const
          : transportMode === 'self_drive'
            ? 'car-outline' as const
            : 'train-outline' as const;
    return { icon, color: '#3978B8', soft: '#EAF4FF' };
  }
  if (kind === 'lodging') {
    return { icon: 'bed-outline' as const, color: '#7657C8', soft: '#F2EEFF' };
  }
  if (kind === 'activity') {
    return { icon: 'ticket-outline' as const, color: '#D56C28', soft: '#FFF1E7' };
  }
  return { icon: 'calendar-outline' as const, color: colors.primaryStrong, soft: colors.primarySoft };
}

function bookingStatusLabel(status?: string): string {
  if (status === 'ticketed') return '已出票';
  if (status === 'confirmed') return '已确认';
  return '计划中';
}

function toChecklistItem(task: ProjectItinerary['tasks'][number]): TripChecklistItem {
  return {
    id: task.id,
    version: task.version,
    title: task.title,
    meta: task.description ?? undefined,
    completed: task.status === 'done',
  };
}

function formatDateRange(start?: string | null, end?: string | null): string {
  if (!start) return '未设置日期';
  const from = parseLocalDate(start);
  const head = `${from.getMonth() + 1}月${from.getDate()}日`;
  if (!end || end === start) return head;
  const to = parseLocalDate(end);
  return `${head} — ${to.getMonth() + 1}月${to.getDate()}日`;
}

function formatDuration(start?: string | null, end?: string | null): string {
  if (!start || !end) return '';
  const days =
    Math.round((parseLocalDate(end).getTime() - parseLocalDate(start).getTime()) / 86_400_000) + 1;
  return days > 0 ? `${days} 天` : '';
}
