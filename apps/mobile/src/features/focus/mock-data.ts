import { todayTasks } from '@/mocks/data';

import type { FocusTaskReference } from './model';

export const focusTaskOptions: FocusTaskReference[] = todayTasks.map((task) => ({
  id: task.id,
  title: task.title,
  list: task.list,
  color: task.color,
  time: task.time,
}));

