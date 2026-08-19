import type { ComponentProps } from 'react';

import type { AppIcon } from '@/components/ui/icon';

type IconName = ComponentProps<typeof AppIcon>['name'];

export type TripAgendaItem = {
  id: string;
  time: string;
  title: string;
  meta: string;
  icon: IconName;
  color: string;
  soft: string;
};

export type TripDay = {
  id: string;
  date: string;
  weekday: string;
  label: string;
  agenda: TripAgendaItem[];
};

export type TripBooking = {
  id: string;
  title: string;
  meta: string;
  status: string;
  icon: IconName;
  color: string;
  soft: string;
};

export type TripChecklistItem = {
  id: string;
  title: string;
  meta?: string;
  completed: boolean;
};

export type TripPlan = {
  id: string;
  title: string;
  destination: string;
  dateRange: string;
  duration: string;
  status: 'upcoming' | 'completed';
  statusLabel: string;
  statusTone: 'primary' | 'neutral';
  days: TripDay[];
  bookings: TripBooking[];
  checklist: TripChecklistItem[];
};
