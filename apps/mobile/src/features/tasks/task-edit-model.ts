import type { Task, TaskPriority, UpdateTaskRequest } from '@steward/api-client';

export type TaskEditDraft = {
  title: string;
  description: string;
  priority: TaskPriority;
  listId: string;
  projectId: string;
  focusDate: string;
  dueKind: 'none' | 'date' | 'time';
  originalDueKind: 'none' | 'date' | 'time';
  dueValue: string;
  scheduledStart: string;
  scheduledEnd: string;
  estimatedMinutes: string;
};

export function taskEditDraft(task: Task): TaskEditDraft {
  return {
    title: task.title,
    description: task.description ?? '',
    priority: task.priority,
    listId: task.list_id,
    projectId: task.project_id ?? '',
    focusDate: task.focus_date ?? '',
    dueKind: task.due_at ? 'time' : task.due_date ? 'date' : 'none',
    originalDueKind: task.due_at ? 'time' : task.due_date ? 'date' : 'none',
    dueValue: task.due_at ? formatLocalDateTime(task.due_at) : task.due_date ?? '',
    scheduledStart: task.scheduled_start_at ? formatLocalDateTime(task.scheduled_start_at) : '',
    scheduledEnd: task.scheduled_end_at ? formatLocalDateTime(task.scheduled_end_at) : '',
    estimatedMinutes: task.estimated_minutes ? String(task.estimated_minutes) : '',
  };
}

export function buildTaskEditRequest(draft: TaskEditDraft, timezone: string): UpdateTaskRequest {
  const title = draft.title.trim();
  if (!title) throw new Error('任务标题不能为空');
  const clear: NonNullable<UpdateTaskRequest['clear']> = [];
  const request: UpdateTaskRequest = {
    title,
    priority: draft.priority,
    list_id: draft.listId,
    due_timezone: draft.dueKind === 'none' ? null : timezone,
    scheduled_timezone: draft.scheduledStart || draft.scheduledEnd ? timezone : null,
  };

  assignText(request, clear, 'description', draft.description);
  assignText(request, clear, 'project_id', draft.projectId);
  assignText(request, clear, 'focus_date', draft.focusDate);

  if (draft.dueKind === 'date') {
    if (!isDate(draft.dueValue)) throw new Error('截止日期请使用 YYYY-MM-DD');
    request.due_date = draft.dueValue;
    clear.push('due_at');
  } else if (draft.dueKind === 'time') {
    request.due_at = parseLocalDateTime(draft.dueValue);
    clear.push('due_date');
  } else {
    clear.push('due_date', 'due_at', 'reminders');
  }
  if (draft.dueKind !== draft.originalDueKind) clear.push('reminders');

  assignDateTime(request, clear, 'scheduled_start_at', draft.scheduledStart);
  assignDateTime(request, clear, 'scheduled_end_at', draft.scheduledEnd);
  if (draft.scheduledStart && draft.scheduledEnd
    && new Date(request.scheduled_end_at!).getTime() <= new Date(request.scheduled_start_at!).getTime()) {
    throw new Error('计划结束时间必须晚于开始时间');
  }

  const minutes = draft.estimatedMinutes.trim();
  if (!minutes) clear.push('estimated_minutes');
  else {
    const value = Number(minutes);
    if (!Number.isInteger(value) || value <= 0) throw new Error('预计时长必须是正整数');
    request.estimated_minutes = value;
  }
  request.clear = [...new Set(clear)];
  return request;
}

function assignText(
  request: UpdateTaskRequest,
  clear: NonNullable<UpdateTaskRequest['clear']>,
  field: 'description' | 'project_id' | 'focus_date',
  value: string,
) {
  const trimmed = value.trim();
  if (trimmed) request[field] = trimmed;
  else clear.push(field);
}

function assignDateTime(
  request: UpdateTaskRequest,
  clear: NonNullable<UpdateTaskRequest['clear']>,
  field: 'scheduled_start_at' | 'scheduled_end_at',
  value: string,
) {
  if (value.trim()) request[field] = parseLocalDateTime(value);
  else clear.push(field);
}

export function parseLocalDateTime(value: string): string {
  const normalized = value.trim().replace(' ', 'T');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)) {
    throw new Error('时间请使用 YYYY-MM-DD HH:mm');
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) throw new Error('时间无效');
  return date.toISOString();
}

export function formatLocalDateTime(value: string): string {
  const date = new Date(value);
  const part = (number: number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())} ${part(date.getHours())}:${part(date.getMinutes())}`;
}

function isDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}
