import { todayTasks } from '@/mocks/data';

import type { FocusRecord, FocusTaskReference } from './model';

export const focusTaskOptions: FocusTaskReference[] = todayTasks.map((task) => ({
  id: task.id,
  title: task.title,
  list: task.list,
  color: task.color,
  time: task.time,
}));

const now = Date.now();

export const initialFocusRecords: FocusRecord[] = [
  {
    id: 'focus-demo-review',
    task: focusTaskOptions[0],
    mode: 'pomodoro',
    plannedSeconds: 30 * 60,
    elapsedSeconds: 30 * 60,
    completedAt: new Date(now - 95 * 60 * 1000).toISOString(),
    taskCompleted: false,
    quality: 'smooth',
    thoughts: [],
  },
  {
    id: 'focus-demo-email',
    task: focusTaskOptions[1],
    mode: 'pomodoro',
    plannedSeconds: 25 * 60,
    elapsedSeconds: 25 * 60,
    completedAt: new Date(now - 210 * 60 * 1000).toISOString(),
    taskCompleted: true,
    quality: 'normal',
    thoughts: [],
  },
];
